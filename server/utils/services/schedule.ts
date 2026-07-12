import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { court, lessonException, lessonSeries, lessonSession, reservation } from '../../database/app-schema'
import { member } from '../../database/schema'
import type { ExtendResult, LessonDetail, LessonSeriesDto, LessonSessionDto, MaterializationSweepResult, ScheduleSessionDto } from '../../database/types'
import { isSport, type Sport } from '../../../shared/org-profile'
import {
  DEFAULT_LESSON_COLOR,
  MATERIALIZATION_HORIZON_DAYS,
  expandOccurrences,
  isCapacityRangeValid,
  localDateTimeToInstant,
  type ExceptionAction
} from '../../../shared/schedule'
import { rangesOverlap } from '../../../shared/reservation'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import {
  scheduleSeriesCreateSchema,
  scheduleSeriesMetadataPatchSchema,
  seriesAssignmentSchema,
  seriesScheduleSchema,
  sessionUpdateSchema
} from '../../../shared/schedule-schema'
import { pgErrorCode, pgErrorConstraint } from '../pgError'
import { getOrgProfile } from './orgProfile'
import { toOrgRole } from './membership'

// Academy scheduling service. `reservation` (core, occupancy) and the lesson
// tables (Academy) are app-owned, so this writes them with Drizzle directly
// (rule 4 is scoped to Better-Auth tables). Every query is scoped by
// organizationId — never id alone — for multi-tenant isolation.
//
// A lesson is always modeled as a series (rrule null = one-off) plus its
// materialized sessions, each consuming one core reservation. Court
// double-booking is guaranteed by the Postgres EXCLUDE constraint on
// reservation; the service adds a friendly pre-check and the coach-overlap check
// the single-court constraint can't express. Static field rules live in the
// shared Zod schema; context rules (sport offered, court/coach resolve, capacity
// range) live here.

const MS_PER_DAY = 86_400_000

const SERIES_COLUMNS = {
  id: lessonSeries.id,
  type: lessonSeries.type,
  sport: lessonSeries.sport,
  title: lessonSeries.title,
  color: lessonSeries.color,
  level: lessonSeries.level,
  ageGroup: lessonSeries.ageGroup,
  notes: lessonSeries.notes,
  coachMemberId: lessonSeries.coachMemberId,
  assistantCoachMemberId: lessonSeries.assistantCoachMemberId,
  defaultCourtId: lessonSeries.defaultCourtId,
  timezone: lessonSeries.timezone,
  rrule: lessonSeries.rrule,
  dtStart: lessonSeries.dtStart,
  durationMin: lessonSeries.durationMin,
  capacityMin: lessonSeries.capacityMin,
  capacityMax: lessonSeries.capacityMax,
  enrollmentOpen: lessonSeries.enrollmentOpen,
  visibility: lessonSeries.visibility,
  status: lessonSeries.status,
  materializedUntil: lessonSeries.materializedUntil,
  createdAt: lessonSeries.createdAt
}

const SESSION_COLUMNS = {
  id: lessonSession.id,
  seriesId: lessonSession.seriesId,
  reservationId: lessonSession.reservationId,
  occurrenceStart: lessonSession.occurrenceStart,
  startsAt: lessonSession.startsAt,
  endsAt: lessonSession.endsAt,
  coachMemberId: lessonSession.coachMemberId,
  courtId: lessonSession.courtId,
  capacityMax: lessonSession.capacityMax,
  status: lessonSession.status,
  cancelReason: lessonSession.cancelReason,
  overridden: lessonSession.overridden,
  notes: lessonSession.notes
}

const createSchema = scheduleSeriesCreateSchema(code => code)
const metadataPatchSchema = scheduleSeriesMetadataPatchSchema(code => code)
const sessionSchema = sessionUpdateSchema(code => code)
const assignmentSchema = seriesAssignmentSchema(code => code)
const scheduleSchema = seriesScheduleSchema(code => code)

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

function conflict(message: string, code: string, data: Record<string, string> = {}): never {
  throw createError({ statusCode: 409, statusMessage: message, data: { code, ...data } })
}

// Postgres exclusion_violation (23P01). Today the reservation table has exactly
// one exclusion constraint (reservation_no_court_overlap), so an unnamed 23P01
// is a court conflict; a DIFFERENT named exclusion (e.g. a future coach-time
// constraint) is NOT relabeled a court conflict — it rethrows for its own path.
function courtOverlapViolation(error: unknown): boolean {
  if (pgErrorCode(error) !== '23P01') return false
  const name = pgErrorConstraint(error)
  // Specific to the court constraint; an unnamed 23P01 falls back to court (the
  // original constraint). A coach clash always carries its own name, so check
  // coachOverlapViolation FIRST where both are possible.
  return name === undefined || name === 'reservation_no_court_overlap'
}

// Postgres exclusion_violation (23P01) from the coach-overlap EXCLUDE on
// lesson_session (lesson_session_no_coach_overlap) — the race-safe backstop for
// the same coach being double-booked across courts. The friendly, occurrence-
// specific error comes from the assertNoCoachConflict pre-check; this only fires
// on a genuine concurrent write the pre-check couldn't see.
function coachOverlapViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23P01' && pgErrorConstraint(error) === 'lesson_session_no_coach_overlap'
}

// The sport must be one the facility offers (orgProfile.sports). Defense in
// depth: the builder only offers declared sports. Takes the already-loaded
// offered sports so createLesson fetches the profile once.
function requireOfferedSport(offeredSports: readonly string[] | null, sport: string): Sport {
  if (!isSport(sport)) bad('Invalid sport', 'SCHEDULE_SPORT_INVALID')
  if (!(offeredSports ?? []).includes(sport)) bad('Sport not offered by this facility', 'SCHEDULE_SPORT_NOT_OFFERED')
  return sport
}

// The court must belong to this facility, be active (not archived), and be a
// court of the lesson's sport — you can't run a padel lesson on a tennis court.
async function requireCourt(organizationId: string, courtId: string, sport: Sport): Promise<void> {
  const [row] = await db
    .select({ id: court.id, sport: court.sport, archivedAt: court.archivedAt })
    .from(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
    .limit(1)
  if (!row || row.archivedAt) bad('Court not found', 'SCHEDULE_COURT_NOT_FOUND')
  if (row!.sport !== sport) bad('Court is not for this sport', 'SCHEDULE_COURT_SPORT_MISMATCH')
}

// A coach/assistant must be a member of this facility and NOT a student.
async function requireCoach(organizationId: string, memberId: string): Promise<void> {
  const [row] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.id, memberId)))
    .limit(1)
  if (!row) bad('Coach not found', 'SCHEDULE_COACH_NOT_FOUND')
  if (toOrgRole(row!.role) === 'student') bad('Assigned coach cannot be a student', 'SCHEDULE_COACH_INVALID_ROLE')
}

// A time range to conflict-check. Occurrence is assignable (it has startsAt/endsAt).
interface Interval {
  startsAt: Date
  endsAt: Date
}

function windowBounds(intervals: Interval[]): { minStart: Date, maxEnd: Date } {
  let minStart = intervals[0]!.startsAt
  let maxEnd = intervals[0]!.endsAt
  for (const i of intervals) {
    if (i.startsAt < minStart) minStart = i.startsAt
    if (i.endsAt > maxEnd) maxEnd = i.endsAt
  }
  return { minStart, maxEnd }
}

// Friendly pre-check: reject if any interval overlaps an existing non-cancelled
// reservation on the same court. `excludeReservationIds` skips the rows being
// edited so an update never conflicts with itself. The EXCLUDE constraint is the
// authoritative, race-safe guarantee; this just yields a specific error.
async function assertNoCourtConflict(
  organizationId: string,
  courtId: string,
  intervals: Interval[],
  excludeReservationIds: string[] = []
): Promise<void> {
  if (intervals.length === 0) return
  const { minStart, maxEnd } = windowBounds(intervals)
  const existing = await db
    .select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
    .from(reservation)
    .where(and(
      eq(reservation.organizationId, organizationId),
      eq(reservation.courtId, courtId),
      ne(reservation.status, 'cancelled'),
      lt(reservation.startsAt, maxEnd),
      gt(reservation.endsAt, minStart),
      ...(excludeReservationIds.length ? [notInArray(reservation.id, excludeReservationIds)] : [])
    ))
  for (const interval of intervals) {
    for (const r of existing) {
      if (rangesOverlap(interval.startsAt, interval.endsAt, r.startsAt, r.endsAt)) {
        conflict('Court already booked at this time', 'SCHEDULE_COURT_CONFLICT', { at: interval.startsAt.toISOString() })
      }
    }
  }
}

// A coach can't teach two overlapping sessions. There is no DB constraint for
// this yet (a single-court EXCLUDE can't span courts), so this service check is
// best-effort in v1 — a concurrent create could still double-book a coach. A
// coach-time EXCLUDE is the documented hardening path. `excludeSessionIds` skips
// the sessions being edited (so an update/reassign never conflicts with itself).
async function assertNoCoachConflict(
  organizationId: string,
  coachMemberId: string,
  intervals: Interval[],
  excludeSessionIds: string[] = []
): Promise<void> {
  if (intervals.length === 0) return
  const { minStart, maxEnd } = windowBounds(intervals)
  const existing = await db
    .select({ startsAt: lessonSession.startsAt, endsAt: lessonSession.endsAt })
    .from(lessonSession)
    .where(and(
      eq(lessonSession.organizationId, organizationId),
      eq(lessonSession.coachMemberId, coachMemberId),
      ne(lessonSession.status, 'cancelled'),
      lt(lessonSession.startsAt, maxEnd),
      gt(lessonSession.endsAt, minStart),
      ...(excludeSessionIds.length ? [notInArray(lessonSession.id, excludeSessionIds)] : [])
    ))
  for (const interval of intervals) {
    for (const s of existing) {
      if (rangesOverlap(interval.startsAt, interval.endsAt, s.startsAt, s.endsAt)) {
        conflict('Coach is already teaching at this time', 'SCHEDULE_COACH_CONFLICT', { at: interval.startsAt.toISOString() })
      }
    }
  }
}

export async function createLesson(organizationId: string, body: unknown, userId: string): Promise<LessonDetail> {
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) bad('Invalid lesson', 'INVALID_LESSON')
  const values = parsed.data

  // One profile fetch feeds both the offered-sport check and the timezone
  // snapshot. getOrgProfile types timezone as nullable but always returns a
  // default; the fallback keeps it a guaranteed string for the notNull column.
  const profile = await getOrgProfile(organizationId)
  const sport = requireOfferedSport(profile.sports, values.sport)
  if (!isCapacityRangeValid(values.capacityMin, values.capacityMax)) {
    bad('capacityMin must be ≤ capacityMax', 'SCHEDULE_CAPACITY_RANGE')
  }
  const timezone = values.timezone ?? profile.timezone ?? REGIONAL_FALLBACK.timezone

  await requireCourt(organizationId, values.defaultCourtId, sport)
  if (values.coachMemberId) await requireCoach(organizationId, values.coachMemberId)

  // Materialize the near-term horizon. A recurring series rolls forward from
  // today, so a past start date still yields UPCOMING sessions (not only past
  // ones); a one-off materializes exactly its (possibly historical) occurrence.
  const startInstant = localDateTimeToInstant(values.dtStart, timezone)
  const now = new Date()
  const windowStart = values.rrule
    ? new Date(Math.max(now.getTime(), startInstant.getTime()))
    : startInstant
  const windowEnd = new Date(windowStart.getTime() + MATERIALIZATION_HORIZON_DAYS * MS_PER_DAY)
  const occurrences = expandOccurrences({
    dtStart: values.dtStart,
    timezone,
    durationMin: values.durationMin,
    rrule: values.rrule ?? null,
    from: windowStart,
    to: windowEnd
  })
  if (occurrences.length === 0) bad('No occurrences in the scheduling window', 'SCHEDULE_NO_OCCURRENCES')

  await assertNoCourtConflict(organizationId, values.defaultCourtId, occurrences)
  if (values.coachMemberId) await assertNoCoachConflict(organizationId, values.coachMemberId, occurrences)

  // Pre-build every row (ids up front so sessions reference their reservation),
  // then two bulk inserts inside the transaction — not a per-occurrence loop of
  // round-trips holding locks across a large fan-out.
  const seriesId = randomUUID()
  const reservationRows = occurrences.map(occ => ({
    id: randomUUID(),
    organizationId,
    courtId: values.defaultCourtId,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    status: 'confirmed',
    kind: 'lesson',
    createdBy: userId
  }))
  const sessionRows = occurrences.map((occ, i) => ({
    id: randomUUID(),
    organizationId,
    seriesId,
    reservationId: reservationRows[i]!.id,
    occurrenceStart: occ.occurrenceStart,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    // Resolved coach/court for this occurrence (denormalized from the series);
    // capacity is left null = inherit the series' capacity.
    coachMemberId: values.coachMemberId ?? null,
    courtId: values.defaultCourtId,
    status: 'scheduled',
    overridden: false
  }))

  try {
    await db.transaction(async (tx) => {
      await tx.insert(lessonSeries).values({
        id: seriesId,
        organizationId,
        type: values.type,
        sport,
        title: values.title,
        color: values.color ?? DEFAULT_LESSON_COLOR,
        level: values.level ?? null,
        ageGroup: values.ageGroup ?? null,
        notes: values.notes ?? null,
        coachMemberId: values.coachMemberId ?? null,
        defaultCourtId: values.defaultCourtId,
        timezone,
        rrule: values.rrule ?? null,
        dtStart: values.dtStart,
        durationMin: values.durationMin,
        capacityMin: values.capacityMin ?? null,
        capacityMax: values.capacityMax ?? null,
        enrollmentOpen: values.enrollmentOpen ?? true,
        visibility: values.visibility ?? 'members',
        status: 'active',
        materializedUntil: windowEnd,
        createdBy: userId
      })
      await tx.insert(reservation).values(reservationRows)
      await tx.insert(lessonSession).values(sessionRows)
    })
  } catch (error) {
    if (coachOverlapViolation(error)) conflict('Coach is already teaching at this time', 'SCHEDULE_COACH_CONFLICT')
    if (courtOverlapViolation(error)) conflict('Court already booked at this time', 'SCHEDULE_COURT_CONFLICT')
    throw error
  }

  return (await getSeries(organizationId, seriesId))!
}

// A series with its sessions. Null when the id isn't this facility's.
export async function getSeries(organizationId: string, seriesId: string): Promise<LessonDetail | null> {
  const [series] = await db
    .select(SERIES_COLUMNS)
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!series) return null

  const sessions = await db
    .select(SESSION_COLUMNS)
    .from(lessonSession)
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.seriesId, seriesId)))
    .orderBy(asc(lessonSession.startsAt))

  return { series, sessions }
}

// Sessions overlapping [from, to) by their start, flattened with series display
// fields and reservation status — the calendar/roster read shape. Scoped by org.
export async function listSessions(
  organizationId: string,
  range: { from: Date, to: Date, coachMemberId?: string }
): Promise<ScheduleSessionDto[]> {
  // Explicit projection matching ScheduleSessionDto exactly (no cancelReason —
  // that's on the detail DTO, not the calendar shape). The seriesId INNER JOIN
  // is safe: every session has a series (seriesId is NOT NULL).
  return db
    .select({
      id: lessonSession.id,
      seriesId: lessonSession.seriesId,
      reservationId: lessonSession.reservationId,
      occurrenceStart: lessonSession.occurrenceStart,
      startsAt: lessonSession.startsAt,
      endsAt: lessonSession.endsAt,
      coachMemberId: lessonSession.coachMemberId,
      courtId: lessonSession.courtId,
      capacityMax: lessonSession.capacityMax,
      status: lessonSession.status,
      overridden: lessonSession.overridden,
      notes: lessonSession.notes,
      reservationStatus: reservation.status,
      seriesTitle: lessonSeries.title,
      type: lessonSeries.type,
      sport: lessonSeries.sport,
      color: lessonSeries.color
    })
    .from(lessonSession)
    .innerJoin(lessonSeries, eq(lessonSession.seriesId, lessonSeries.id))
    .innerJoin(reservation, eq(lessonSession.reservationId, reservation.id))
    .where(and(
      eq(lessonSession.organizationId, organizationId),
      gte(lessonSession.startsAt, range.from),
      lt(lessonSession.startsAt, range.to),
      ...(range.coachMemberId ? [eq(lessonSession.coachMemberId, range.coachMemberId)] : [])
    ))
    .orderBy(asc(lessonSession.startsAt))
}

// Cancel a whole series: mark it and every still-scheduled session cancelled,
// and cancel those sessions' reservations so the courts free up (the partial
// EXCLUDE ignores cancelled rows). Completed/already-cancelled sessions are left
// as history. Null when the id isn't this facility's.
export async function cancelSeries(
  organizationId: string,
  seriesId: string,
  reason?: string
): Promise<LessonDetail | null> {
  const [existing] = await db
    .select({ id: lessonSeries.id })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!existing) return null

  await db.transaction(async (tx) => {
    // Active = not already cancelled/completed. Freeing only 'scheduled' would
    // leave a 'rescheduled' session's reservation confirmed → phantom occupancy.
    const activeWhere = and(
      eq(lessonSession.organizationId, organizationId),
      eq(lessonSession.seriesId, seriesId),
      inArray(lessonSession.status, ['scheduled', 'rescheduled'])
    )

    const sessions = await tx
      .select({ reservationId: lessonSession.reservationId })
      .from(lessonSession)
      .where(activeWhere)
    const reservationIds = sessions.map(s => s.reservationId)

    if (reservationIds.length > 0) {
      await tx
        .update(reservation)
        .set({ status: 'cancelled' })
        .where(and(eq(reservation.organizationId, organizationId), inArray(reservation.id, reservationIds)))
    }

    await tx
      .update(lessonSession)
      .set({ status: 'cancelled', cancelReason: reason ?? null })
      .where(activeWhere)

    await tx
      .update(lessonSeries)
      .set({ status: 'cancelled' })
      .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
  })

  return getSeries(organizationId, seriesId)
}

// Update series metadata that doesn't touch sessions/reservations (title,
// colour, capacity, enrolment policy, …). Structural edits (time/court/coach/
// recurrence) that need occurrence propagation land in a later phase, so the
// metadata patch schema can't express them. Null when the id isn't this org's.
export async function updateSeriesMetadata(
  organizationId: string,
  seriesId: string,
  body: unknown
): Promise<LessonDetail | null> {
  const parsed = metadataPatchSchema.safeParse(body)
  if (!parsed.success) bad('Invalid lesson', 'INVALID_LESSON')
  const values = parsed.data

  const [existing] = await db
    .select({ capacityMin: lessonSeries.capacityMin, capacityMax: lessonSeries.capacityMax })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!existing) return null

  // Validate the capacity range against the effective (possibly stored) values.
  const effMin = values.capacityMin !== undefined ? values.capacityMin : existing.capacityMin
  const effMax = values.capacityMax !== undefined ? values.capacityMax : existing.capacityMax
  if (!isCapacityRangeValid(effMin, effMax)) bad('capacityMin must be ≤ capacityMax', 'SCHEDULE_CAPACITY_RANGE')

  const set: Partial<typeof lessonSeries.$inferInsert> = {}
  if (values.title !== undefined) set.title = values.title
  if (values.color !== undefined) set.color = values.color
  if (values.level !== undefined) set.level = values.level
  if (values.ageGroup !== undefined) set.ageGroup = values.ageGroup
  if (values.notes !== undefined) set.notes = values.notes
  if (values.capacityMin !== undefined) set.capacityMin = values.capacityMin
  if (values.capacityMax !== undefined) set.capacityMax = values.capacityMax
  if (values.visibility !== undefined) set.visibility = values.visibility
  if (values.enrollmentOpen !== undefined) set.enrollmentOpen = values.enrollmentOpen

  if (Object.keys(set).length > 0) {
    await db
      .update(lessonSeries)
      .set(set)
      .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
  }

  return getSeries(organizationId, seriesId)
}

// Edit a series' STRUCTURE — wall-clock start, duration and recurrence — by
// re-materializing the FUTURE from the new schedule. Policy ("this & following"):
// past/in-progress sessions (startsAt < now) stay as history; every future
// session + its reservation is deleted and regenerated, so any single-occurrence
// overrides/exceptions and per-session drop-in enrolments from now on are reset
// (deleting a session cascades its drop-ins + attendance). SERIES enrolments are
// untouched (they reference the series, not sessions), so the group carries over.
// Court/coach/sport stay put (separate assignment edit). Conflicts are enforced
// by the same EXCLUDE backstops as create — the whole change is atomic. Null when
// the series isn't this facility's.
export async function updateSeriesSchedule(
  organizationId: string,
  seriesId: string,
  body: unknown
): Promise<LessonDetail | null> {
  const parsed = scheduleSchema.safeParse(body)
  if (!parsed.success) bad('Invalid schedule', 'INVALID_LESSON')
  const values = parsed.data

  const [series] = await db
    .select({
      timezone: lessonSeries.timezone,
      sport: lessonSeries.sport,
      defaultCourtId: lessonSeries.defaultCourtId,
      coachMemberId: lessonSeries.coachMemberId,
      status: lessonSeries.status,
      createdBy: lessonSeries.createdBy
    })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!series) return null
  if (series.status !== 'active') bad('This series is not active', 'SCHEDULE_SERIES_INACTIVE')
  const courtId = series.defaultCourtId
  if (!courtId) bad('This series has no court', 'SCHEDULE_COURT_UNAVAILABLE')

  // The court must still be active and match the series' sport (same guard as
  // create/extend) — a schedule change can't silently re-book an archived court.
  const [courtRow] = await db
    .select({ archivedAt: court.archivedAt, sport: court.sport })
    .from(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
    .limit(1)
  if (!courtRow || courtRow.archivedAt || courtRow.sport !== series.sport) {
    bad('The series court is unavailable', 'SCHEDULE_COURT_UNAVAILABLE')
  }

  const timezone = series.timezone
  const startInstant = localDateTimeToInstant(values.dtStart, timezone)
  const now = new Date()
  // A one-off can't be re-timed into the past (there'd be no future occurrence);
  // a recurring series anchored in the past is fine — it rolls from now.
  if (!values.rrule && startInstant.getTime() < now.getTime()) {
    bad('The start must be in the future', 'SCHEDULE_DTSTART_PAST')
  }

  const windowStart = values.rrule ? new Date(Math.max(now.getTime(), startInstant.getTime())) : startInstant
  const windowEnd = new Date(windowStart.getTime() + MATERIALIZATION_HORIZON_DAYS * MS_PER_DAY)
  const occurrences = expandOccurrences({
    dtStart: values.dtStart,
    timezone,
    durationMin: values.durationMin,
    rrule: values.rrule ?? null,
    from: windowStart,
    to: windowEnd
  })
  if (occurrences.length === 0) bad('No occurrences in the scheduling window', 'SCHEDULE_NO_OCCURRENCES')

  const reservationRows = occurrences.map(occ => ({
    id: randomUUID(),
    organizationId,
    courtId,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    status: 'confirmed',
    kind: 'lesson',
    createdBy: series.createdBy
  }))
  const sessionRows = occurrences.map((occ, i) => ({
    id: randomUUID(),
    organizationId,
    seriesId,
    reservationId: reservationRows[i]!.id,
    occurrenceStart: occ.occurrenceStart,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    coachMemberId: series.coachMemberId,
    courtId,
    status: 'scheduled',
    overridden: false
  }))

  try {
    await db.transaction(async (tx) => {
      // Delete the future only (startsAt >= now). Deleting a session cascades its
      // drop-in enrolments + attendance; the reservation FK points the other way,
      // so those are removed explicitly after (the app-schema lifecycle contract).
      const future = await tx
        .select({ id: lessonSession.id, reservationId: lessonSession.reservationId })
        .from(lessonSession)
        .where(and(
          eq(lessonSession.organizationId, organizationId),
          eq(lessonSession.seriesId, seriesId),
          gte(lessonSession.startsAt, now)
        ))
      if (future.length > 0) {
        await tx.delete(lessonSession).where(and(
          eq(lessonSession.organizationId, organizationId),
          inArray(lessonSession.id, future.map(f => f.id))
        ))
        await tx.delete(reservation).where(and(
          eq(reservation.organizationId, organizationId),
          inArray(reservation.id, future.map(f => f.reservationId))
        ))
      }
      // Future divergences no longer map to the new pattern.
      await tx.delete(lessonException).where(and(
        eq(lessonException.organizationId, organizationId),
        eq(lessonException.seriesId, seriesId),
        gte(lessonException.occurrenceStart, now)
      ))

      await tx
        .update(lessonSeries)
        .set({
          dtStart: values.dtStart,
          durationMin: values.durationMin,
          rrule: values.rrule ?? null,
          materializedUntil: windowEnd
        })
        .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))

      await tx.insert(reservation).values(reservationRows)
      await tx.insert(lessonSession).values(sessionRows)
    })
  } catch (error) {
    if (coachOverlapViolation(error)) conflict('Coach is already teaching at this time', 'SCHEDULE_COACH_CONFLICT')
    if (courtOverlapViolation(error)) conflict('Court already booked at this time', 'SCHEDULE_COURT_CONFLICT')
    throw error
  }

  return getSeries(organizationId, seriesId)
}

// Hard-delete a series (irreversible). Cascades to its sessions (and their
// enrolments/attendance) via FKs; the sessions' reservations do NOT cascade up
// (core has no FK to Academy), so they are deleted explicitly here — the
// lifecycle contract in app-schema.ts. Returns false when not this facility's.
export async function purgeSeries(organizationId: string, seriesId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: lessonSeries.id })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!existing) return false

  await db.transaction(async (tx) => {
    const sessions = await tx
      .select({ reservationId: lessonSession.reservationId })
      .from(lessonSession)
      .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.seriesId, seriesId)))
    const reservationIds = sessions.map(s => s.reservationId)

    await tx
      .delete(lessonSeries)
      .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))

    if (reservationIds.length > 0) {
      await tx
        .delete(reservation)
        .where(and(eq(reservation.organizationId, organizationId), inArray(reservation.id, reservationIds)))
    }
  })

  return true
}

// ─── Phase 3: single-occurrence exceptions, propagation, horizon extension ───

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const MS_PER_MINUTE = 60_000

// The durable divergence ledger (iCalendar EXDATE / RECURRENCE-ID). Upserted on
// the (series, occurrenceStart) unique key so re-editing an occurrence updates
// its record rather than duplicating it.
async function recordException(
  tx: Tx,
  organizationId: string,
  seriesId: string,
  occurrenceStart: Date,
  action: ExceptionAction,
  sessionId: string | null
): Promise<void> {
  await tx
    .insert(lessonException)
    .values({ id: randomUUID(), organizationId, seriesId, occurrenceStart, action, sessionId })
    .onConflictDoUpdate({
      target: [lessonException.seriesId, lessonException.occurrenceStart],
      set: { action, sessionId }
    })
}

async function removeException(tx: Tx, organizationId: string, seriesId: string, occurrenceStart: Date): Promise<void> {
  await tx.delete(lessonException).where(and(
    eq(lessonException.organizationId, organizationId),
    eq(lessonException.seriesId, seriesId),
    eq(lessonException.occurrenceStart, occurrenceStart)
  ))
}

// Record an occurrence the horizon extension couldn't materialize (court/coach
// conflict) as a durable, visible gap — so it's never silently lost, and the
// next extend won't re-attempt it (the skip-set excludes exception occurrences).
async function recordSkip(organizationId: string, seriesId: string, occurrenceStart: Date): Promise<void> {
  await db
    .insert(lessonException)
    .values({ id: randomUUID(), organizationId, seriesId, occurrenceStart, action: 'skipped', sessionId: null })
    .onConflictDoNothing()
}

// Whether this series already has a materialized session for the given occurrence.
// Distinguishes a benign concurrent-materialization race (another writer of THIS
// series won the court/coach EXCLUDE) from a genuine clash with a DIFFERENT
// booking — so the horizon extension never records a spurious skip for an
// occurrence that in fact got created.
async function sessionExistsForOccurrence(organizationId: string, seriesId: string, occurrenceStart: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: lessonSession.id })
    .from(lessonSession)
    .where(and(
      eq(lessonSession.organizationId, organizationId),
      eq(lessonSession.seriesId, seriesId),
      eq(lessonSession.occurrenceStart, occurrenceStart)
    ))
    .limit(1)
  return Boolean(row)
}

// Whether a session's effective state diverges from what its series template
// would produce for its occurrence (anchor time + series duration/court/coach,
// plus any capacity override). Drives `overridden` — so a series reassignment
// skips manually-changed occurrences — and, via `timeChanged`, the moved status.
// Comparing to the TEMPLATE (not the row's current values) means a no-op edit
// never flags an occurrence, and moving one back onto its anchor clears the flag.
function computeDivergence(input: {
  occurrenceStart: Date
  seriesDurationMin: number
  seriesDefaultCourtId: string | null
  seriesCoachMemberId: string | null
  startsAt: Date
  endsAt: Date
  courtId: string | null
  coachMemberId: string | null
  capacityMax: number | null
}): { overridden: boolean, timeChanged: boolean } {
  const templateEnd = input.occurrenceStart.getTime() + input.seriesDurationMin * MS_PER_MINUTE
  const timeChanged = input.startsAt.getTime() !== input.occurrenceStart.getTime()
    || input.endsAt.getTime() !== templateEnd
  const overridden = timeChanged
    || input.courtId !== input.seriesDefaultCourtId
    || input.coachMemberId !== input.seriesCoachMemberId
    || input.capacityMax !== null
  return { overridden, timeChanged }
}

// One session (calendar/detail shape). Null when the id isn't this facility's.
export async function getLessonSession(organizationId: string, sessionId: string): Promise<LessonSessionDto | null> {
  const [row] = await db
    .select(SESSION_COLUMNS)
    .from(lessonSession)
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
    .limit(1)
  return row ?? null
}

// Internal: a session joined with the series context an occurrence op needs.
async function getSessionContext(organizationId: string, sessionId: string) {
  const [row] = await db
    .select({
      id: lessonSession.id,
      seriesId: lessonSession.seriesId,
      reservationId: lessonSession.reservationId,
      occurrenceStart: lessonSession.occurrenceStart,
      startsAt: lessonSession.startsAt,
      endsAt: lessonSession.endsAt,
      courtId: lessonSession.courtId,
      coachMemberId: lessonSession.coachMemberId,
      capacityMax: lessonSession.capacityMax,
      notes: lessonSession.notes,
      status: lessonSession.status,
      timezone: lessonSeries.timezone,
      sport: lessonSeries.sport,
      seriesStatus: lessonSeries.status,
      seriesDurationMin: lessonSeries.durationMin,
      seriesDefaultCourtId: lessonSeries.defaultCourtId,
      seriesCoachMemberId: lessonSeries.coachMemberId
    })
    .from(lessonSession)
    .innerJoin(lessonSeries, eq(lessonSession.seriesId, lessonSeries.id))
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
    .limit(1)
  return row ?? null
}

// Cancel a single occurrence: its reservation frees the court, the session is
// marked cancelled, and an EXDATE exception is recorded so re-materialization
// never regenerates it. Idempotent. Null when not this facility's.
export async function cancelLessonSession(
  organizationId: string,
  sessionId: string,
  reason?: string
): Promise<LessonSessionDto | null> {
  const row = await getSessionContext(organizationId, sessionId)
  if (!row) return null
  if (row.status === 'cancelled') return getLessonSession(organizationId, sessionId)

  await db.transaction(async (tx) => {
    await tx
      .update(reservation)
      .set({ status: 'cancelled' })
      .where(and(eq(reservation.organizationId, organizationId), eq(reservation.id, row.reservationId)))
    await tx
      .update(lessonSession)
      .set({ status: 'cancelled', cancelReason: reason ?? null })
      .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
    await recordException(tx, organizationId, row.seriesId, row.occurrenceStart, 'cancelled', sessionId)
  })

  return getLessonSession(organizationId, sessionId)
}

// Restore a cancelled occurrence: re-confirm its reservation (re-checking the
// slot is still free — court + coach) and mark it scheduled. Its exception is
// re-derived from the session's actual state (an occurrence cancelled while it
// was also rescheduled/overridden stays diverged; a plain one clears). Rejected
// when the parent series is cancelled — its occurrences must not be resurrected
// into a zombie. A non-cancelled session is returned unchanged. Null when not
// this facility's.
export async function restoreLessonSession(organizationId: string, sessionId: string): Promise<LessonSessionDto | null> {
  const row = await getSessionContext(organizationId, sessionId)
  if (!row) return null
  if (row.status !== 'cancelled') return getLessonSession(organizationId, sessionId)
  if (row.seriesStatus !== 'active') bad('Series is not active', 'SCHEDULE_SERIES_NOT_ACTIVE')

  const interval = [{ startsAt: row.startsAt, endsAt: row.endsAt }]
  await assertNoCourtConflict(organizationId, row.courtId!, interval, [row.reservationId])
  if (row.coachMemberId) await assertNoCoachConflict(organizationId, row.coachMemberId, interval, [sessionId])

  const { overridden, timeChanged } = computeDivergence({
    occurrenceStart: row.occurrenceStart,
    seriesDurationMin: row.seriesDurationMin,
    seriesDefaultCourtId: row.seriesDefaultCourtId,
    seriesCoachMemberId: row.seriesCoachMemberId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    courtId: row.courtId,
    coachMemberId: row.coachMemberId,
    capacityMax: row.capacityMax
  })

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(reservation)
        .set({ status: 'confirmed' })
        .where(and(eq(reservation.organizationId, organizationId), eq(reservation.id, row.reservationId)))
      await tx
        .update(lessonSession)
        .set({ status: timeChanged ? 'rescheduled' : 'scheduled', cancelReason: null, overridden })
        .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
      if (overridden) {
        await recordException(tx, organizationId, row.seriesId, row.occurrenceStart, timeChanged ? 'rescheduled' : 'modified', sessionId)
      } else {
        await removeException(tx, organizationId, row.seriesId, row.occurrenceStart)
      }
    })
  } catch (error) {
    if (coachOverlapViolation(error)) conflict('Coach is already teaching at this time', 'SCHEDULE_COACH_CONFLICT')
    if (courtOverlapViolation(error)) conflict('Court already booked at this time', 'SCHEDULE_COURT_CONFLICT')
    throw error
  }

  return getLessonSession(organizationId, sessionId)
}

// Edit a single occurrence — reschedule (new time/court) and/or override (coach/
// capacity/notes) "just this once". Re-validates court/coach and re-checks
// conflicts EXCLUDING this occurrence itself, marks it overridden (so a series
// edit skips it), and records a rescheduled/modified exception. Null when not
// this facility's.
export async function updateLessonSession(
  organizationId: string,
  sessionId: string,
  body: unknown
): Promise<LessonSessionDto | null> {
  const parsed = sessionSchema.safeParse(body)
  if (!parsed.success) bad('Invalid session', 'INVALID_LESSON')
  const values = parsed.data

  const row = await getSessionContext(organizationId, sessionId)
  if (!row) return null
  if (row.status === 'cancelled') bad('Cannot edit a cancelled occurrence', 'SCHEDULE_SESSION_CANCELLED')

  const newStart = values.startsAt ? localDateTimeToInstant(values.startsAt, row.timezone) : row.startsAt
  const durationMin = values.durationMin ?? Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / MS_PER_MINUTE)
  const newEnd = new Date(newStart.getTime() + durationMin * MS_PER_MINUTE)
  const newCourtId = values.courtId ?? row.courtId
  if (!newCourtId) bad('Court not found', 'SCHEDULE_COURT_NOT_FOUND')
  const newCoachId = values.coachMemberId !== undefined ? values.coachMemberId : row.coachMemberId
  const newCapacity = values.capacityMax !== undefined ? values.capacityMax : row.capacityMax
  const newNotes = values.notes !== undefined ? values.notes : row.notes

  await requireCourt(organizationId, newCourtId, row.sport as Sport)
  if (newCoachId) await requireCoach(organizationId, newCoachId)

  const interval = [{ startsAt: newStart, endsAt: newEnd }]
  await assertNoCourtConflict(organizationId, newCourtId, interval, [row.reservationId])
  if (newCoachId) await assertNoCoachConflict(organizationId, newCoachId, interval, [sessionId])

  // Divergence is measured against the series template, not the current row: a
  // no-op edit never flags the occurrence, and moving it back onto its anchor
  // clears the flag (so a later series reassignment picks it up again).
  const { overridden, timeChanged } = computeDivergence({
    occurrenceStart: row.occurrenceStart,
    seriesDurationMin: row.seriesDurationMin,
    seriesDefaultCourtId: row.seriesDefaultCourtId,
    seriesCoachMemberId: row.seriesCoachMemberId,
    startsAt: newStart,
    endsAt: newEnd,
    courtId: newCourtId,
    coachMemberId: newCoachId,
    capacityMax: newCapacity
  })

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(reservation)
        .set({ startsAt: newStart, endsAt: newEnd, courtId: newCourtId })
        .where(and(eq(reservation.organizationId, organizationId), eq(reservation.id, row.reservationId)))
      await tx
        .update(lessonSession)
        .set({
          startsAt: newStart,
          endsAt: newEnd,
          courtId: newCourtId,
          coachMemberId: newCoachId,
          capacityMax: newCapacity,
          notes: newNotes,
          overridden,
          status: timeChanged ? 'rescheduled' : 'scheduled'
        })
        .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
      if (overridden) {
        await recordException(tx, organizationId, row.seriesId, row.occurrenceStart, timeChanged ? 'rescheduled' : 'modified', sessionId)
      } else {
        await removeException(tx, organizationId, row.seriesId, row.occurrenceStart)
      }
    })
  } catch (error) {
    if (coachOverlapViolation(error)) conflict('Coach is already teaching at this time', 'SCHEDULE_COACH_CONFLICT')
    if (courtOverlapViolation(error)) conflict('Court already booked at this time', 'SCHEDULE_COURT_CONFLICT')
    throw error
  }

  return getLessonSession(organizationId, sessionId)
}

// Reassign a whole series' lead coach and/or default court, propagating to
// FUTURE, non-overridden, scheduled sessions (past and manually-diverged ones
// keep their values). Re-checks conflicts for the new coach/court across the
// affected occurrences. Null when not this facility's.
export async function updateSeriesAssignment(
  organizationId: string,
  seriesId: string,
  body: unknown
): Promise<LessonDetail | null> {
  const parsed = assignmentSchema.safeParse(body)
  if (!parsed.success) bad('Invalid lesson', 'INVALID_LESSON')
  const values = parsed.data

  const [series] = await db
    .select({
      id: lessonSeries.id,
      sport: lessonSeries.sport,
      coachMemberId: lessonSeries.coachMemberId,
      defaultCourtId: lessonSeries.defaultCourtId
    })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!series) return null

  const coachChanged = values.coachMemberId !== undefined
  const nextCourt = values.defaultCourtId // string when the court is being changed
  if (!coachChanged && nextCourt === undefined) return getSeries(organizationId, seriesId)

  const nextCoach = coachChanged ? (values.coachMemberId ?? null) : series.coachMemberId
  if (nextCoach) await requireCoach(organizationId, nextCoach)
  if (nextCourt !== undefined) await requireCourt(organizationId, nextCourt, series.sport as Sport)

  // Future, non-overridden, scheduled sessions inherit the change.
  const now = new Date()
  const targets = await db
    .select({
      id: lessonSession.id,
      reservationId: lessonSession.reservationId,
      startsAt: lessonSession.startsAt,
      endsAt: lessonSession.endsAt
    })
    .from(lessonSession)
    .where(and(
      eq(lessonSession.organizationId, organizationId),
      eq(lessonSession.seriesId, seriesId),
      eq(lessonSession.overridden, false),
      eq(lessonSession.status, 'scheduled'),
      gte(lessonSession.startsAt, now)
    ))
  const intervals = targets.map(t => ({ startsAt: t.startsAt, endsAt: t.endsAt }))
  const sessionIds = targets.map(t => t.id)
  const reservationIds = targets.map(t => t.reservationId)

  if (coachChanged && nextCoach) await assertNoCoachConflict(organizationId, nextCoach, intervals, sessionIds)
  if (nextCourt !== undefined) await assertNoCourtConflict(organizationId, nextCourt, intervals, reservationIds)

  try {
    await db.transaction(async (tx) => {
      const seriesSet: Partial<typeof lessonSeries.$inferInsert> = {}
      if (coachChanged) seriesSet.coachMemberId = nextCoach
      if (nextCourt !== undefined) seriesSet.defaultCourtId = nextCourt
      await tx
        .update(lessonSeries)
        .set(seriesSet)
        .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))

      if (sessionIds.length > 0) {
        const sessionSet: Partial<typeof lessonSession.$inferInsert> = {}
        if (coachChanged) sessionSet.coachMemberId = nextCoach
        if (nextCourt !== undefined) sessionSet.courtId = nextCourt
        await tx
          .update(lessonSession)
          .set(sessionSet)
          .where(and(eq(lessonSession.organizationId, organizationId), inArray(lessonSession.id, sessionIds)))
        if (nextCourt !== undefined) {
          await tx
            .update(reservation)
            .set({ courtId: nextCourt })
            .where(and(eq(reservation.organizationId, organizationId), inArray(reservation.id, reservationIds)))
        }
      }
    })
  } catch (error) {
    if (coachOverlapViolation(error)) conflict('Coach is already teaching at this time', 'SCHEDULE_COACH_CONFLICT')
    if (courtOverlapViolation(error)) conflict('Court already booked at this time', 'SCHEDULE_COURT_CONFLICT')
    throw error
  }

  return getSeries(organizationId, seriesId)
}

// Roll a recurring series' materialization horizon forward to now + HORIZON,
// creating the newly-in-range occurrences (skipping ones that already exist or
// carry an exception). Court conflicts are enforced by the EXCLUDE and skipped;
// coach conflicts are pre-checked and skipped (best-effort, per-occurrence, so
// one clash never blocks the rest). Meant to be called by a job or on demand.
// Null when not this facility's.
export async function extendMaterialization(organizationId: string, seriesId: string): Promise<ExtendResult | null> {
  const [series] = await db
    .select({
      id: lessonSeries.id,
      rrule: lessonSeries.rrule,
      dtStart: lessonSeries.dtStart,
      durationMin: lessonSeries.durationMin,
      timezone: lessonSeries.timezone,
      sport: lessonSeries.sport,
      defaultCourtId: lessonSeries.defaultCourtId,
      coachMemberId: lessonSeries.coachMemberId,
      status: lessonSeries.status,
      materializedUntil: lessonSeries.materializedUntil,
      createdBy: lessonSeries.createdBy
    })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!series) return null

  const now = new Date()
  const to = new Date(now.getTime() + MATERIALIZATION_HORIZON_DAYS * MS_PER_DAY)
  const unchanged: ExtendResult = { created: 0, skipped: 0, materializedUntil: series.materializedUntil }

  if (!series.rrule || series.status !== 'active') return unchanged
  if (!series.defaultCourtId) return unchanged
  const courtId = series.defaultCourtId

  // Don't materialize onto a court that has been archived or whose sport no
  // longer matches (the create/edit paths reject these; extend must too). The
  // series has to be reassigned to a valid court before it can grow again.
  const [courtRow] = await db
    .select({ archivedAt: court.archivedAt, sport: court.sport })
    .from(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
    .limit(1)
  if (!courtRow || courtRow.archivedAt || courtRow.sport !== series.sport) return unchanged

  const from = series.materializedUntil ?? now
  if (from >= to) return unchanged

  const occurrences = expandOccurrences({
    dtStart: series.dtStart,
    timezone: series.timezone,
    durationMin: series.durationMin,
    rrule: series.rrule,
    from,
    to
  })

  // Skip occurrences that already have a session or an exception (EXDATE).
  const [existing, excepted] = await Promise.all([
    db.select({ occurrenceStart: lessonSession.occurrenceStart })
      .from(lessonSession)
      .where(and(
        eq(lessonSession.organizationId, organizationId),
        eq(lessonSession.seriesId, seriesId),
        gte(lessonSession.occurrenceStart, from),
        lt(lessonSession.occurrenceStart, to)
      )),
    db.select({ occurrenceStart: lessonException.occurrenceStart })
      .from(lessonException)
      .where(and(
        eq(lessonException.organizationId, organizationId),
        eq(lessonException.seriesId, seriesId),
        gte(lessonException.occurrenceStart, from),
        lt(lessonException.occurrenceStart, to)
      ))
  ])
  const taken = new Set([...existing, ...excepted].map(r => r.occurrenceStart.getTime()))
  const fresh = occurrences.filter(o => !taken.has(o.occurrenceStart.getTime()))

  // The coach's busy intervals in the window — for best-effort coach-conflict skip.
  const coachBusy: Interval[] = series.coachMemberId
    ? await db.select({ startsAt: lessonSession.startsAt, endsAt: lessonSession.endsAt })
        .from(lessonSession)
        .where(and(
          eq(lessonSession.organizationId, organizationId),
          eq(lessonSession.coachMemberId, series.coachMemberId),
          ne(lessonSession.status, 'cancelled'),
          lt(lessonSession.startsAt, to),
          gt(lessonSession.endsAt, from)
        ))
    : []

  let created = 0
  let skipped = 0
  for (const occ of fresh) {
    // Coach already busy → record a durable skip (not a silent gap) and move on.
    if (coachBusy.some(b => rangesOverlap(occ.startsAt, occ.endsAt, b.startsAt, b.endsAt))) {
      await recordSkip(organizationId, seriesId, occ.occurrenceStart)
      skipped++
      continue
    }
    const reservationId = randomUUID()
    try {
      await db.transaction(async (tx) => {
        await tx.insert(reservation).values({
          id: reservationId,
          organizationId,
          courtId,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          status: 'confirmed',
          kind: 'lesson',
          createdBy: series.createdBy
        })
        await tx.insert(lessonSession).values({
          id: randomUUID(),
          organizationId,
          seriesId,
          reservationId,
          occurrenceStart: occ.occurrenceStart,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          coachMemberId: series.coachMemberId,
          courtId,
          status: 'scheduled',
          overridden: false
        })
      })
      created++
      if (series.coachMemberId) coachBusy.push({ startsAt: occ.startsAt, endsAt: occ.endsAt })
    } catch (error) {
      // A court/coach EXCLUDE fired. If THIS series already has a session for the
      // occurrence, a concurrent materializer of the SAME series won the race —
      // the clash is with its own row, not a foreign booking, so it's benign and
      // must NOT be recorded as a skip (that would flag a materialized occurrence
      // as skipped). Otherwise the court/coach is genuinely taken by something
      // else → record a durable, visible skip so it's never silently lost.
      if (courtOverlapViolation(error) || coachOverlapViolation(error)) {
        if (await sessionExistsForOccurrence(organizationId, seriesId, occ.occurrenceStart)) continue
        await recordSkip(organizationId, seriesId, occ.occurrenceStart)
        skipped++
        continue
      }
      // The unique (series, occurrenceStart) guard tripped — already materialized. Benign.
      if (pgErrorCode(error) === '23505') continue
      throw error
    }
  }

  await db
    .update(lessonSeries)
    .set({ materializedUntil: to })
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))

  return { created, skipped, materializedUntil: to }
}

// ─── Materialization sweep (the scheduled job) ───────────────────────────────

// A recurring series is refilled once its materialized runway drops below this
// many days. With the MATERIALIZATION_HORIZON_DAYS (120) fill, each series is then
// touched roughly every (120 − 90) = 30 days rather than on every sweep — bounding
// the work at scale while always keeping months of sessions materialized ahead.
const MATERIALIZATION_REFILL_BELOW_DAYS = 90

// Hard cap on series processed in one sweep, so a run is always bounded regardless
// of tenant count. If more are due, `capped` is returned true and the remainder is
// picked up next run — the long horizon makes being one run behind inconsequential.
const MATERIALIZATION_SWEEP_MAX_SERIES = 1000

// In-process reentrancy guard: if a sweep is still running when the next tick
// fires (or a manual run overlaps), skip rather than double-work. This covers the
// common single-instance deployment. Cross-instance dedup (horizontal scaling) is
// a deliberate seam, NOT a correctness gap: extendMaterialization is fully
// idempotent and race-safe (unique occurrence guard + court/coach EXCLUDE +
// sessionExistsForOccurrence), so concurrent sweeps are safe, only wasteful — a
// Postgres advisory lock / lease row behind this flag is the documented hardening
// path (mirrors the realtime single-process seam in server/utils/realtime.ts).
let sweepInProgress = false

// Roll the materialization horizon forward for EVERY active recurring series whose
// runway has dropped below the refill threshold, across all tenants. Each series
// goes through the same idempotent extendMaterialization; one series' failure is
// logged and never aborts the sweep. Driven by the scheduled task
// (server/tasks/schedule/materialize.ts); also safe to call ad hoc.
export async function runMaterializationSweep(): Promise<MaterializationSweepResult> {
  if (sweepInProgress) {
    return { status: 'busy', processed: 0, created: 0, skipped: 0, failed: 0, capped: false }
  }
  sweepInProgress = true
  try {
    const threshold = new Date(Date.now() + MATERIALIZATION_REFILL_BELOW_DAYS * MS_PER_DAY)
    // Fetch one more than the cap so we can report whether the run was capped.
    const due = await db
      .select({ organizationId: lessonSeries.organizationId, id: lessonSeries.id })
      .from(lessonSeries)
      .where(and(
        isNotNull(lessonSeries.rrule),
        eq(lessonSeries.status, 'active'),
        or(isNull(lessonSeries.materializedUntil), lt(lessonSeries.materializedUntil, threshold))
      ))
      .orderBy(sql`${lessonSeries.materializedUntil} asc nulls first`)
      .limit(MATERIALIZATION_SWEEP_MAX_SERIES + 1)

    const capped = due.length > MATERIALIZATION_SWEEP_MAX_SERIES
    const batch = capped ? due.slice(0, MATERIALIZATION_SWEEP_MAX_SERIES) : due

    let created = 0
    let skipped = 0
    let failed = 0
    for (const series of batch) {
      try {
        const result = await extendMaterialization(series.organizationId, series.id)
        if (result) {
          created += result.created
          skipped += result.skipped
        }
      } catch (error) {
        failed++
        console.error(`[schedule:materialize] series ${series.id} failed`, error)
      }
    }
    return { status: 'ok', processed: batch.length, created, skipped, failed, capped }
  } finally {
    sweepInProgress = false
  }
}

export type { LessonSeriesDto, LessonSessionDto }
