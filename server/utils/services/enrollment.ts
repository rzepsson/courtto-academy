import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, gte, inArray, lt, max, ne, or } from 'drizzle-orm'
import { db } from '../db'
import { attendance, enrollment, lessonSeries, lessonSession, reservation } from '../../database/app-schema'
import { member, user } from '../../database/schema'
import type { EnrollmentDto, EnrollmentView, RosterEntry, StudentSessionView } from '../../database/types'
import { isAttendanceStatus } from '../../../shared/schedule'

// Academy enrolment + attendance service. App-owned tables, written with Drizzle
// directly; every query scoped by organizationId (multi-tenant isolation).
//
// Capacity is enforced under a per-SERIES row lock (SELECT … FOR UPDATE): a
// series enrolment counts against series.capacityMax, and a per-session drop-in
// counts against the session's effective capacity (session.capacityMax ??
// series.capacityMax) alongside the series' enrolees. Locking the series row for
// EVERY enrol/cancel serialises them, so two concurrent enrolments can't both
// take the last seat. When full, an enrolment is waitlisted with a position;
// cancelling an enrolled seat promotes the first waitlisted in the same scope.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ENROLLMENT_COLUMNS = {
  id: enrollment.id,
  studentMemberId: enrollment.studentMemberId,
  seriesId: enrollment.seriesId,
  sessionId: enrollment.sessionId,
  status: enrollment.status,
  waitlistPos: enrollment.waitlistPos,
  createdAt: enrollment.createdAt
}

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

function forbidden(message: string, code: string): never {
  throw createError({ statusCode: 403, statusMessage: message, data: { code } })
}

async function requireStudentMember(organizationId: string, studentMemberId: string): Promise<void> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.id, studentMemberId)))
    .limit(1)
  if (!row) bad('Student is not a member of this school', 'SCHEDULE_STUDENT_NOT_FOUND')
}

async function nextWaitlistPos(tx: Tx, where: ReturnType<typeof and>): Promise<number> {
  const [row] = await tx.select({ max: max(enrollment.waitlistPos) }).from(enrollment).where(where)
  return (row?.max ?? 0) + 1
}

// Enrol a student in a whole series (the recurring path). Idempotent while
// active; a previously cancelled enrolment is re-activated. Null when the series
// isn't this facility's.
export async function enrollInSeries(
  organizationId: string,
  seriesId: string,
  studentMemberId: string
): Promise<EnrollmentDto | null> {
  await requireStudentMember(organizationId, studentMemberId)

  return db.transaction(async (tx) => {
    const [series] = await tx
      .select({ status: lessonSeries.status, enrollmentOpen: lessonSeries.enrollmentOpen, capacityMax: lessonSeries.capacityMax })
      .from(lessonSeries)
      .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
      .limit(1)
      .for('update')
    if (!series) return null
    if (series.status !== 'active') bad('This series is not accepting enrolments', 'SCHEDULE_ENROLLMENT_UNAVAILABLE')
    if (!series.enrollmentOpen) bad('Enrolment is closed for this series', 'SCHEDULE_ENROLLMENT_CLOSED')

    const [existing] = await tx
      .select(ENROLLMENT_COLUMNS)
      .from(enrollment)
      .where(and(
        eq(enrollment.organizationId, organizationId),
        eq(enrollment.seriesId, seriesId),
        eq(enrollment.studentMemberId, studentMemberId)
      ))
      .limit(1)
    if (existing && existing.status !== 'cancelled') return existing

    const [tally] = await tx
      .select({ n: count() })
      .from(enrollment)
      .where(and(
        eq(enrollment.organizationId, organizationId),
        eq(enrollment.seriesId, seriesId),
        eq(enrollment.status, 'enrolled')
      ))
    const full = series.capacityMax != null && (tally?.n ?? 0) >= series.capacityMax
    const status = full ? 'waitlisted' : 'enrolled'
    const waitlistPos = full
      ? await nextWaitlistPos(tx, and(
          eq(enrollment.organizationId, organizationId),
          eq(enrollment.seriesId, seriesId),
          eq(enrollment.status, 'waitlisted')
        ))
      : null

    if (existing) {
      const [updated] = await tx
        .update(enrollment)
        .set({ status, waitlistPos })
        .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, existing.id)))
        .returning(ENROLLMENT_COLUMNS)
      return updated!
    }
    const [created] = await tx
      .insert(enrollment)
      .values({ id: randomUUID(), organizationId, studentMemberId, seriesId, status, waitlistPos })
      .returning(ENROLLMENT_COLUMNS)
    return created!
  })
}

// Enrol a student in a single session (drop-in / make-up). Rejected if they're
// already enrolled in the parent series. Counts against the session's effective
// capacity alongside the series' enrolees. Null when the session isn't this org's.
export async function enrollInSession(
  organizationId: string,
  sessionId: string,
  studentMemberId: string
): Promise<EnrollmentDto | null> {
  await requireStudentMember(organizationId, studentMemberId)

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ seriesId: lessonSession.seriesId, status: lessonSession.status, capacityMax: lessonSession.capacityMax })
      .from(lessonSession)
      .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
      .limit(1)
    if (!session) return null
    if (session.status !== 'scheduled' && session.status !== 'rescheduled') {
      bad('This session is not accepting enrolments', 'SCHEDULE_ENROLLMENT_UNAVAILABLE')
    }

    // Lock the series so drop-in and series enrolments can't race on capacity.
    const [series] = await tx
      .select({ status: lessonSeries.status, enrollmentOpen: lessonSeries.enrollmentOpen, capacityMax: lessonSeries.capacityMax })
      .from(lessonSeries)
      .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, session.seriesId)))
      .limit(1)
      .for('update')
    if (!series) return null
    if (series.status !== 'active') bad('This series is not accepting enrolments', 'SCHEDULE_ENROLLMENT_UNAVAILABLE')
    if (!series.enrollmentOpen) bad('Enrolment is closed for this series', 'SCHEDULE_ENROLLMENT_CLOSED')

    // Only a confirmed series SEAT blocks a drop-in; a series-waitlisted student
    // (no seat) may still drop into a specific session that has room.
    const [seriesEnrolment] = await tx
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(and(
        eq(enrollment.organizationId, organizationId),
        eq(enrollment.seriesId, session.seriesId),
        eq(enrollment.studentMemberId, studentMemberId),
        eq(enrollment.status, 'enrolled')
      ))
      .limit(1)
    if (seriesEnrolment) bad('Already enrolled in this series', 'SCHEDULE_ALREADY_ENROLLED')

    const [existing] = await tx
      .select(ENROLLMENT_COLUMNS)
      .from(enrollment)
      .where(and(
        eq(enrollment.organizationId, organizationId),
        eq(enrollment.sessionId, sessionId),
        eq(enrollment.studentMemberId, studentMemberId)
      ))
      .limit(1)
    if (existing && existing.status !== 'cancelled') return existing

    const effectiveCap = session.capacityMax ?? series.capacityMax
    const [seriesTally] = await tx
      .select({ n: count() })
      .from(enrollment)
      .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.seriesId, session.seriesId), eq(enrollment.status, 'enrolled')))
    const [dropTally] = await tx
      .select({ n: count() })
      .from(enrollment)
      .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.sessionId, sessionId), eq(enrollment.status, 'enrolled')))
    const total = (seriesTally?.n ?? 0) + (dropTally?.n ?? 0)
    const full = effectiveCap != null && total >= effectiveCap
    const status = full ? 'waitlisted' : 'enrolled'
    const waitlistPos = full
      ? await nextWaitlistPos(tx, and(
          eq(enrollment.organizationId, organizationId),
          eq(enrollment.sessionId, sessionId),
          eq(enrollment.status, 'waitlisted')
        ))
      : null

    if (existing) {
      const [updated] = await tx
        .update(enrollment)
        .set({ status, waitlistPos })
        .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, existing.id)))
        .returning(ENROLLMENT_COLUMNS)
      return updated!
    }
    const [created] = await tx
      .insert(enrollment)
      .values({ id: randomUUID(), organizationId, studentMemberId, sessionId, status, waitlistPos })
      .returning(ENROLLMENT_COLUMNS)
    return created!
  })
}

// Cancel an enrolment; if it held an ENROLLED seat, promote the first waitlisted
// student in the same scope. Serialised under the series lock, and the current
// status is RE-READ under that lock — so a double-cancel (two requests on one
// enrolled seat) promotes exactly once, never over-capacity. When
// `ownerStudentMemberId` is given (a student cancelling their own), someone
// else's enrolment is treated as not found (no info leak). Null when the id
// isn't this facility's.
//
// Scope note: the series waitlist and each session's drop-in waitlist are
// INDEPENDENT queues. Cancelling a series seat promotes the series waitlist;
// cancelling a drop-in seat promotes that session's drop-in waitlist. A freed
// series seat is not auto-promoted into a session's drop-in queue (that seat is
// offered back to the series queue, then available for new enrolments) — a
// deliberate model, not a gap.
export async function cancelEnrollment(
  organizationId: string,
  enrollmentId: string,
  ownerStudentMemberId?: string
): Promise<EnrollmentDto | null> {
  const [existing] = await db
    .select(ENROLLMENT_COLUMNS)
    .from(enrollment)
    .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, enrollmentId)))
    .limit(1)
  if (!existing) return null
  if (ownerStudentMemberId !== undefined && existing.studentMemberId !== ownerStudentMemberId) return null

  return db.transaction(async (tx) => {
    // Resolve and lock the owning series (a session enrolment locks its session's series).
    let lockSeriesId = existing.seriesId
    if (!lockSeriesId && existing.sessionId) {
      const [s] = await tx
        .select({ seriesId: lessonSession.seriesId })
        .from(lessonSession)
        .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, existing.sessionId)))
        .limit(1)
      lockSeriesId = s?.seriesId ?? null
    }
    if (lockSeriesId) {
      await tx
        .select({ id: lessonSeries.id })
        .from(lessonSeries)
        .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, lockSeriesId)))
        .limit(1)
        .for('update')
    }

    // Re-read the status under the lock: a concurrent cancel may have already run.
    const [current] = await tx
      .select(ENROLLMENT_COLUMNS)
      .from(enrollment)
      .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, enrollmentId)))
      .limit(1)
    if (!current) return null
    if (current.status === 'cancelled') return current // already cancelled → no double promotion

    const wasEnrolled = current.status === 'enrolled'
    const [cancelled] = await tx
      .update(enrollment)
      .set({ status: 'cancelled', waitlistPos: null })
      .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, enrollmentId)))
      .returning(ENROLLMENT_COLUMNS)

    if (wasEnrolled) {
      const scopeWhere = existing.seriesId
        ? and(eq(enrollment.organizationId, organizationId), eq(enrollment.seriesId, existing.seriesId), eq(enrollment.status, 'waitlisted'))
        : and(eq(enrollment.organizationId, organizationId), eq(enrollment.sessionId, existing.sessionId!), eq(enrollment.status, 'waitlisted'))
      const [next] = await tx
        .select({ id: enrollment.id })
        .from(enrollment)
        .where(scopeWhere)
        .orderBy(asc(enrollment.waitlistPos))
        .limit(1)
      if (next) {
        await tx
          .update(enrollment)
          .set({ status: 'enrolled', waitlistPos: null })
          .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, next.id)))
      }
    }

    return cancelled!
  })
}

// The full enrolment list for a series (enrolled + waitlisted, in queue order),
// with the students' display fields — the staff roster/management view.
export async function listSeriesEnrollments(organizationId: string, seriesId: string): Promise<EnrollmentView[]> {
  return db
    .select({
      id: enrollment.id,
      studentMemberId: enrollment.studentMemberId,
      studentName: user.name,
      studentEmail: user.email,
      seriesId: enrollment.seriesId,
      sessionId: enrollment.sessionId,
      status: enrollment.status,
      waitlistPos: enrollment.waitlistPos,
      createdAt: enrollment.createdAt
    })
    .from(enrollment)
    .innerJoin(member, eq(enrollment.studentMemberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(
      eq(enrollment.organizationId, organizationId),
      eq(enrollment.seriesId, seriesId),
      ne(enrollment.status, 'cancelled')
    ))
    .orderBy(asc(enrollment.status), asc(enrollment.waitlistPos), asc(enrollment.createdAt))
}

// The attendance roster for one session: every enrolled attendee (series enrolee
// or session drop-in) with their marked attendance, if any. When `asCoachMemberId`
// is given (coach area), the session must be that coach's own. Null when the
// session isn't this facility's.
export async function getSessionRoster(
  organizationId: string,
  sessionId: string,
  asCoachMemberId?: string
): Promise<RosterEntry[] | null> {
  const [session] = await db
    .select({ seriesId: lessonSession.seriesId, coachMemberId: lessonSession.coachMemberId })
    .from(lessonSession)
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
    .limit(1)
  if (!session) return null
  if (asCoachMemberId !== undefined && session.coachMemberId !== asCoachMemberId) {
    forbidden('You can only view your own sessions', 'SCHEDULE_ATTENDANCE_FORBIDDEN')
  }

  const rows = await db
    .select({
      studentMemberId: enrollment.studentMemberId,
      studentName: user.name,
      studentEmail: user.email,
      seriesId: enrollment.seriesId
    })
    .from(enrollment)
    .innerJoin(member, eq(enrollment.studentMemberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(
      eq(enrollment.organizationId, organizationId),
      eq(enrollment.status, 'enrolled'),
      or(eq(enrollment.seriesId, session.seriesId), eq(enrollment.sessionId, sessionId))
    ))

  const marks = await db
    .select({ studentMemberId: attendance.studentMemberId, status: attendance.status })
    .from(attendance)
    .where(and(eq(attendance.organizationId, organizationId), eq(attendance.sessionId, sessionId)))
  const markByStudent = new Map(marks.map(m => [m.studentMemberId, m.status]))

  // Dedupe by student (a student can't be both series-enrolled and a drop-in for
  // the same session — enrollInSession forbids it — but guard anyway).
  const roster = new Map<string, RosterEntry>()
  for (const row of rows) {
    if (roster.has(row.studentMemberId)) continue
    roster.set(row.studentMemberId, {
      studentMemberId: row.studentMemberId,
      studentName: row.studentName,
      studentEmail: row.studentEmail,
      source: row.seriesId ? 'series' : 'session',
      attendanceStatus: markByStudent.get(row.studentMemberId) ?? null
    })
  }
  return [...roster.values()]
}

interface AttendanceEntry {
  studentMemberId: string
  status: string
}

// Mark attendance for a session (bulk upsert). When `asCoachMemberId` is given
// (the coach area), the session must be that coach's own. Returns the refreshed
// roster. Null when the session isn't this facility's.
export async function markAttendance(
  organizationId: string,
  sessionId: string,
  entries: unknown,
  markedByMemberId: string | null,
  asCoachMemberId?: string
): Promise<RosterEntry[] | null> {
  const [session] = await db
    .select({ coachMemberId: lessonSession.coachMemberId, seriesId: lessonSession.seriesId })
    .from(lessonSession)
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
    .limit(1)
  if (!session) return null
  if (asCoachMemberId !== undefined && session.coachMemberId !== asCoachMemberId) {
    forbidden('You can only mark attendance for your own sessions', 'SCHEDULE_ATTENDANCE_FORBIDDEN')
  }

  if (!Array.isArray(entries) || entries.length === 0) bad('No attendance provided', 'SCHEDULE_ATTENDANCE_INVALID')
  const clean: AttendanceEntry[] = []
  for (const entry of entries as unknown[]) {
    if (typeof entry !== 'object' || entry === null) bad('Invalid attendance entry', 'SCHEDULE_ATTENDANCE_INVALID')
    const { studentMemberId, status } = entry as Record<string, unknown>
    if (typeof studentMemberId !== 'string' || typeof status !== 'string' || !isAttendanceStatus(status)) {
      bad('Invalid attendance entry', 'SCHEDULE_ATTENDANCE_INVALID')
    }
    clean.push({ studentMemberId: studentMemberId as string, status: status as string })
  }

  // Every marked student must be an ENROLLED attendee of this session (series
  // enrolee or drop-in) — you enrol before you can be marked. This also keeps
  // attendance rows from orphaning students absent from the roster.
  const ids = [...new Set(clean.map(e => e.studentMemberId))]
  const enrolled = await db
    .select({ studentMemberId: enrollment.studentMemberId })
    .from(enrollment)
    .where(and(
      eq(enrollment.organizationId, organizationId),
      eq(enrollment.status, 'enrolled'),
      or(eq(enrollment.seriesId, session.seriesId), eq(enrollment.sessionId, sessionId))
    ))
  const enrolledIds = new Set(enrolled.map(r => r.studentMemberId))
  for (const id of ids) {
    if (!enrolledIds.has(id)) bad('Student is not enrolled in this session', 'SCHEDULE_STUDENT_NOT_FOUND')
  }

  const markedAt = new Date()
  await db.transaction(async (tx) => {
    for (const entry of clean) {
      await tx
        .insert(attendance)
        .values({
          id: randomUUID(),
          organizationId,
          sessionId,
          studentMemberId: entry.studentMemberId,
          status: entry.status,
          markedBy: markedByMemberId,
          markedAt
        })
        .onConflictDoUpdate({
          target: [attendance.sessionId, attendance.studentMemberId],
          set: { status: entry.status, markedBy: markedByMemberId, markedAt }
        })
    }
  })

  return getSessionRoster(organizationId, sessionId)
}

// A student's own sessions in [from, to) — every session they're enrolled in
// (series enrolment or drop-in), flattened with the series display and the
// student's enrolment status. Scoped by org + the student's membership.
export async function listStudentSessions(
  organizationId: string,
  studentMemberId: string,
  range: { from: Date, to: Date }
): Promise<StudentSessionView[]> {
  const enrolments = await db
    .select({ seriesId: enrollment.seriesId, sessionId: enrollment.sessionId, status: enrollment.status })
    .from(enrollment)
    .where(and(
      eq(enrollment.organizationId, organizationId),
      eq(enrollment.studentMemberId, studentMemberId),
      ne(enrollment.status, 'cancelled')
    ))

  const seriesIds = [...new Set(enrolments.filter(e => e.seriesId).map(e => e.seriesId!))]
  const sessionIds = [...new Set(enrolments.filter(e => e.sessionId).map(e => e.sessionId!))]
  if (seriesIds.length === 0 && sessionIds.length === 0) return []

  const seriesStatus = new Map(enrolments.filter(e => e.seriesId).map(e => [e.seriesId!, e.status]))
  const sessionStatus = new Map(enrolments.filter(e => e.sessionId).map(e => [e.sessionId!, e.status]))

  const targets = []
  if (seriesIds.length) targets.push(inArray(lessonSession.seriesId, seriesIds))
  if (sessionIds.length) targets.push(inArray(lessonSession.id, sessionIds))

  const rows = await db
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
      or(...targets)
    ))
    .orderBy(asc(lessonSession.startsAt))

  return rows.map(row => ({
    ...row,
    enrollmentStatus: seriesStatus.get(row.seriesId) ?? sessionStatus.get(row.id) ?? 'enrolled'
  }))
}
