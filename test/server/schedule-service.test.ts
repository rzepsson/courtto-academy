import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { and, eq, gt, inArray } from 'drizzle-orm'
import {
  addSeriesRule,
  cancelLessonSession,
  cancelSeries,
  createLesson,
  extendMaterialization,
  getLessonSession,
  getSeries,
  listSessions,
  purgeSeries,
  removeSeriesRule,
  restoreLessonSession,
  runMaterializationSweep,
  updateLessonSession,
  updateSeriesMetadata,
  updateSeriesRule
} from '../../server/utils/services/schedule'
import { enrollInSeries, listSeriesEnrollments } from '../../server/utils/services/enrollment'
import { pgErrorCode, pgErrorConstraint } from '../../server/utils/pgError'
import { createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { db } from '../../server/utils/db'
import { lessonException, lessonSeriesRule, lessonSession, reservation } from '../../server/database/app-schema'
import { addMember, createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

// The service reaches for `createError` as a Nuxt server auto-import; provide it
// so we exercise the real validation/isolation/conflict logic against Postgres.
const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

let orgSeq = 0

interface School {
  owner: SeededUser
  orgId: string
  courtId: string
  padelCourtId: string
  coachMemberId: string
  studentMemberId: string
}

// A school offering tennis + padel, with a tennis court, a padel court, one
// coach and one student — the fixture most schedule tests need.
async function seedSchool(): Promise<School> {
  orgSeq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${orgSeq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis', 'padel'], timezone: 'Europe/Warsaw' })

  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
  const padelCourt = await createCourt(orgId, { name: 'Box 1', sport: 'padel' }, owner.userId)

  const coachUser = await signUp()
  const coachMemberId = await addMember(orgId, coachUser.userId, 'coach')
  const studentUser = await signUp()
  const studentMemberId = await addMember(orgId, studentUser.userId, 'student')

  return { owner, orgId, courtId: court.id, padelCourtId: padelCourt.id, coachMemberId, studentMemberId }
}

// A minimal valid one-off lesson body on the tennis court.
function lessonBody(school: School, overrides: Record<string, unknown> = {}) {
  return {
    type: 'group',
    sport: 'tennis',
    title: 'Grupa A',
    dtStart: '2026-09-07T17:00',
    durationMin: 60,
    defaultCourtId: school.courtId,
    coachMemberId: school.coachMemberId,
    ...overrides
  }
}

describe.skipIf(!hasTestDb)('schedule service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates a one-off lesson: a series, one session, one reservation, no leaked columns', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)

    expect(lesson.series.title).toBe('Grupa A')
    expect(lesson.series.timezone).toBe('Europe/Warsaw') // snapshotted from the profile
    expect(lesson.series.status).toBe('active')
    expect(lesson.rules).toHaveLength(1)
    expect(lesson.rules[0]!.rrule).toBeNull() // one-off
    expect(lesson.sessions).toHaveLength(1)

    const session = lesson.sessions[0]!
    expect(session.status).toBe('scheduled')
    expect(session.courtId).toBe(school.courtId)
    expect(session.coachMemberId).toBe(school.coachMemberId)
    expect(session.reservationId).toBeTruthy()
    // 17:00 Europe/Warsaw wall-clock resolves to the correct instant. 2026-09-07
    // is CEST (UTC+2), so 17:00 local = 15:00Z — a deterministic instant check.
    expect(DateTime.fromJSDate(session.startsAt, { zone: 'Europe/Warsaw' }).hour).toBe(17)
    expect(session.startsAt.getUTCHours()).toBe(15)
    expect(session.endsAt.getTime() - session.startsAt.getTime()).toBe(60 * 60_000)

    // DTOs never leak internal columns.
    expect(lesson.series).not.toHaveProperty('organizationId')
    expect(lesson.series).not.toHaveProperty('createdBy')
    expect(session).not.toHaveProperty('organizationId')
  })

  it('materializes a weekly series to the horizon, holding wall-clock (no DST drift)', async () => {
    const school = await seedSchool()
    // 2026-09-07 is a Monday; a future start, so the window runs Sept→Jan.
    const lesson = await createLesson(
      school.orgId,
      lessonBody(school, { rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      school.owner.userId
    )

    expect(lesson.sessions.length).toBeGreaterThanOrEqual(16)
    // Every session is a Monday at 17:00 LOCAL — the no-drift guarantee, whether
    // or not the (now-relative) window happens to span a DST transition. The
    // instant-level DST correctness is covered deterministically in the unit test.
    for (const s of lesson.sessions) {
      const local = DateTime.fromJSDate(s.startsAt, { zone: 'Europe/Warsaw' })
      expect(local.weekday).toBe(1)
      expect(local.hour).toBe(17)
    }
    expect(lesson.rules[0]!.materializedUntil).not.toBeNull()
  })

  it('rejects a sport the facility does not offer', async () => {
    const school = await seedSchool()
    await expect(createLesson(school.orgId, lessonBody(school, { sport: 'squash' }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_SPORT_NOT_OFFERED' } })
  })

  it('rejects a court whose sport differs from the lesson', async () => {
    const school = await seedSchool()
    // tennis lesson on the padel court
    await expect(createLesson(school.orgId, lessonBody(school, { defaultCourtId: school.padelCourtId }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_COURT_SPORT_MISMATCH' } })
  })

  it('rejects a nonexistent / foreign court', async () => {
    const school = await seedSchool()
    await expect(createLesson(school.orgId, lessonBody(school, { defaultCourtId: 'no-such-court' }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_COURT_NOT_FOUND' } })
  })

  it('rejects a student assigned as coach, and a coach from another tenant', async () => {
    const school = await seedSchool()
    await expect(createLesson(school.orgId, lessonBody(school, { coachMemberId: school.studentMemberId }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_COACH_INVALID_ROLE' } })

    const other = await seedSchool()
    await expect(createLesson(school.orgId, lessonBody(school, { coachMemberId: other.coachMemberId }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_COACH_NOT_FOUND' } })
  })

  it('rejects an admin who is not set up to coach, and accepts them once granted the capability', async () => {
    const school = await seedSchool()
    const adminUser = await signUp()
    const adminMemberId = await addMember(school.orgId, adminUser.userId, 'admin')

    // An admin runs the school but does not teach by default.
    await expect(createLesson(school.orgId, lessonBody(school, { coachMemberId: adminMemberId }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_COACH_INVALID_ROLE' } })

    // Granting the orthogonal capability makes them assignable, without touching
    // their governance role.
    await upsertMemberProfile(school.orgId, adminMemberId, { canCoach: true })
    const lesson = await createLesson(school.orgId, lessonBody(school, { coachMemberId: adminMemberId }), school.owner.userId)
    expect(lesson.sessions[0]!.coachMemberId).toBe(adminMemberId)
  })

  it('rejects a coach whose membership is suspended', async () => {
    const school = await seedSchool()
    await upsertMemberProfile(school.orgId, school.coachMemberId, { status: 'suspended' })

    await expect(createLesson(school.orgId, lessonBody(school), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_COACH_INACTIVE' } })
  })

  it('rejects an inverted capacity range', async () => {
    const school = await seedSchool()
    await expect(createLesson(school.orgId, lessonBody(school, { capacityMin: 8, capacityMax: 4 }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_CAPACITY_RANGE' } })
  })

  it('blocks a second booking overlapping the same court, but allows back-to-back', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)

    // Overlaps 17:00–18:00 → rejected.
    await expect(createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:30', coachMemberId: undefined }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'SCHEDULE_COURT_CONFLICT' } })

    // Back-to-back 18:00–19:00 → allowed (half-open ranges).
    const after = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T18:00', coachMemberId: undefined }), school.owner.userId)
    expect(after.sessions).toHaveLength(1)
  })

  it('blocks a coach teaching two overlapping sessions on different courts', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)

    // Same coach, different (padel) court, overlapping time → coach conflict.
    await expect(createLesson(school.orgId, {
      type: 'group', sport: 'padel', title: 'Padel', dtStart: '2026-09-07T17:30', durationMin: 60,
      defaultCourtId: school.padelCourtId, coachMemberId: school.coachMemberId
    }, school.owner.userId))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'SCHEDULE_COACH_CONFLICT' } })
  })

  it('enforces the coach-overlap EXCLUDE at the DB, even when the service pre-check is bypassed', async () => {
    const school = await seedSchool()
    // A: coached tennis lesson 17–18.
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    // B: coach-LESS padel lesson at the same time (different court → allowed today).
    const b = await createLesson(school.orgId, {
      type: 'group', sport: 'padel', title: 'Padel', dtStart: '2026-09-07T17:00', durationMin: 60,
      defaultCourtId: school.padelCourtId
    }, school.owner.userId)

    // Assigning B's session the SAME coach via a raw update (bypassing the service
    // pre-check, as a concurrent write would) must be stopped by the DB EXCLUDE —
    // the race-safe backstop the pre-check alone can't guarantee.
    const error = await db
      .update(lessonSession)
      .set({ coachMemberId: school.coachMemberId })
      .where(and(eq(lessonSession.organizationId, school.orgId), eq(lessonSession.id, b.sessions[0]!.id)))
      .catch((e: unknown) => e)
    expect(pgErrorCode(error)).toBe('23P01')
    expect(pgErrorConstraint(error)).toBe('lesson_session_no_coach_overlap')
  })

  it('cancelling a series frees the court for a new booking', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)

    // Same slot is blocked while active.
    await expect(createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00', coachMemberId: undefined }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 409 })

    const cancelled = await cancelSeries(school.orgId, lesson.series.id, 'Coach ill')
    expect(cancelled?.series.status).toBe('cancelled')
    expect(cancelled?.sessions.every(s => s.status === 'cancelled')).toBe(true)

    // Court is free again.
    const reused = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00', coachMemberId: undefined }), school.owner.userId)
    expect(reused.sessions).toHaveLength(1)
  })

  it('purging a series removes its sessions AND reservations (no phantom occupancy)', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)

    const purged = await purgeSeries(school.orgId, lesson.series.id)
    expect(purged).toBe(true)
    expect(await getSeries(school.orgId, lesson.series.id)).toBeNull()

    // The reservation is gone too, so the slot is bookable again (would 409 if it lingered).
    const reused = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00', coachMemberId: undefined }), school.owner.userId)
    expect(reused.sessions).toHaveLength(1)
  })

  it('updates safe metadata and rejects a bad capacity range', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { capacityMax: 8 }), school.owner.userId)

    const updated = await updateSeriesMetadata(school.orgId, lesson.series.id, { title: 'Grupa B', capacityMin: 4 })
    expect(updated?.series.title).toBe('Grupa B')
    expect(updated?.series.capacityMin).toBe(4)

    await expect(updateSeriesMetadata(school.orgId, lesson.series.id, { capacityMin: 20 }))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_CAPACITY_RANGE' } })
  })

  it('lists sessions within a window, scoped to the tenant', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)

    const inWindow = await listSessions(school.orgId, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z')
    })
    expect(inWindow).toHaveLength(1)
    expect(inWindow[0]!.seriesTitle).toBe('Grupa A')
    expect(inWindow[0]!.sport).toBe('tennis')

    const outOfWindow = await listSessions(school.orgId, {
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-31T00:00:00Z')
    })
    expect(outOfWindow).toHaveLength(0)
  })

  it('filters sessions to a single court when courtId is given (detail page feed)', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') }

    const onTennis = await listSessions(school.orgId, { ...window, courtId: school.courtId })
    expect(onTennis).toHaveLength(1)
    // The lesson is on the tennis court, so the padel court's feed is empty.
    const onPadel = await listSessions(school.orgId, { ...window, courtId: school.padelCourtId })
    expect(onPadel).toHaveLength(0)
  })

  it('never reads, cancels or purges another tenant’s series', async () => {
    const a = await seedSchool()
    const b = await seedSchool()
    const lessonA = await createLesson(a.orgId, lessonBody(a), a.owner.userId)

    expect(await getSeries(b.orgId, lessonA.series.id)).toBeNull()
    expect(await cancelSeries(b.orgId, lessonA.series.id)).toBeNull()
    expect(await updateSeriesMetadata(b.orgId, lessonA.series.id, { title: 'Hijacked' })).toBeNull()
    expect(await purgeSeries(b.orgId, lessonA.series.id)).toBe(false)

    // A's series is untouched.
    const stillA = await getSeries(a.orgId, lessonA.series.id)
    expect(stillA?.series.title).toBe('Grupa A')
    expect(stillA?.series.status).toBe('active')

    // B's window never sees A's sessions.
    const listB = await listSessions(b.orgId, { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') })
    expect(listB).toHaveLength(0)
  })
})

// Extra coach for substitute / reassignment scenarios.
async function makeCoach(orgId: string): Promise<string> {
  const user = await signUp()
  return addMember(orgId, user.userId, 'coach')
}

describe.skipIf(!hasTestDb)('schedule service — occurrences, edits, extension', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('cancels an occurrence (freeing the court) then refuses to restore onto a taken slot', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    const session = lesson.sessions[0]!

    const cancelled = await cancelLessonSession(school.orgId, session.id, 'coach ill')
    expect(cancelled?.status).toBe('cancelled')

    // Court is free — a new lesson can take the slot.
    const other = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00', coachMemberId: undefined }), school.owner.userId)
    expect(other.sessions).toHaveLength(1)

    // Restoring now collides with that new booking.
    await expect(restoreLessonSession(school.orgId, session.id))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'SCHEDULE_COURT_CONFLICT' } })
  })

  it('restores a cancelled occurrence when the slot is still free', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    const session = lesson.sessions[0]!

    await cancelLessonSession(school.orgId, session.id)
    const restored = await restoreLessonSession(school.orgId, session.id)
    expect(restored?.status).toBe('scheduled')

    // The slot is booked again → a fresh lesson at the same time conflicts.
    await expect(createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00', coachMemberId: undefined }), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('reschedules a single occurrence, moving its reservation and freeing the old slot', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    const session = lesson.sessions[0]!

    const moved = await updateLessonSession(school.orgId, session.id, { startsAt: '2026-09-07T19:00' })
    expect(moved?.status).toBe('rescheduled')
    expect(moved?.overridden).toBe(true)
    expect(DateTime.fromJSDate(moved!.startsAt, { zone: 'Europe/Warsaw' }).hour).toBe(19)

    // The old 17:00 slot is free now → a new lesson can take it.
    const other = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00', coachMemberId: undefined }), school.owner.userId)
    expect(other.sessions).toHaveLength(1)
  })

  it('rejects rescheduling an occurrence onto another booking on the same court', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId) // A 17–18
    const b = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T19:00', coachMemberId: undefined }), school.owner.userId) // B 19–20

    await expect(updateLessonSession(school.orgId, b.sessions[0]!.id, { startsAt: '2026-09-07T17:30' }))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'SCHEDULE_COURT_CONFLICT' } })
  })

  it('overrides the coach for a single occurrence (substitute), keeping the time', async () => {
    const school = await seedSchool()
    const sub = await makeCoach(school.orgId)
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)

    const overridden = await updateLessonSession(school.orgId, lesson.sessions[0]!.id, { coachMemberId: sub })
    expect(overridden?.coachMemberId).toBe(sub)
    expect(overridden?.overridden).toBe(true)
    expect(overridden?.status).toBe('scheduled') // no time change → not "rescheduled"
  })

  it('refuses to edit a cancelled occurrence', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    const session = lesson.sessions[0]!

    await cancelLessonSession(school.orgId, session.id)
    await expect(updateLessonSession(school.orgId, session.id, { startsAt: '2026-09-07T19:00' }))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_SESSION_CANCELLED' } })
  })

  it('extends the materialization horizon, recreating a missing future occurrence, and is idempotent', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(
      school.orgId,
      lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      school.owner.userId
    )
    const sessions = [...lesson.sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    const last = sessions[sessions.length - 1]!

    // Simulate the last occurrence not yet materialized: drop it and pull the rule's horizon back to it.
    await db.delete(lessonSession).where(and(eq(lessonSession.organizationId, school.orgId), eq(lessonSession.id, last.id)))
    await db.delete(reservation).where(and(eq(reservation.organizationId, school.orgId), eq(reservation.id, last.reservationId)))
    await db.update(lessonSeriesRule).set({ materializedUntil: last.occurrenceStart }).where(eq(lessonSeriesRule.seriesId, lesson.series.id))

    const result = await extendMaterialization(school.orgId, lesson.series.id)
    expect(result?.created).toBeGreaterThanOrEqual(1)

    // Second extend has nothing new to do.
    const again = await extendMaterialization(school.orgId, lesson.series.id)
    expect(again?.created).toBe(0)
  })

  it('never touches another tenant’s sessions', async () => {
    const a = await seedSchool()
    const b = await seedSchool()
    const lessonA = await createLesson(a.orgId, lessonBody(a), a.owner.userId)
    const sessionA = lessonA.sessions[0]!

    expect(await getLessonSession(b.orgId, sessionA.id)).toBeNull()
    expect(await cancelLessonSession(b.orgId, sessionA.id)).toBeNull()
    expect(await updateLessonSession(b.orgId, sessionA.id, { startsAt: '2026-09-07T19:00' })).toBeNull()
    expect(await restoreLessonSession(b.orgId, sessionA.id)).toBeNull()

    // A's session is untouched.
    expect((await getLessonSession(a.orgId, sessionA.id))?.status).toBe('scheduled')
  })

  it('does not flag an occurrence as overridden on a no-op edit', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    const same = await updateLessonSession(school.orgId, lesson.sessions[0]!.id, {})
    // Template-aligned → NOT flagged, so a later series reassignment still reaches it.
    expect(same?.overridden).toBe(false)
    expect(same?.status).toBe('scheduled')
  })

  it('clears the moved flag when an occurrence is rescheduled back onto its anchor', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    const session = lesson.sessions[0]!

    const moved = await updateLessonSession(school.orgId, session.id, { startsAt: '2026-09-07T19:00' })
    expect(moved?.status).toBe('rescheduled')
    expect(moved?.overridden).toBe(true)

    const back = await updateLessonSession(school.orgId, session.id, { startsAt: '2026-09-07T17:00' })
    expect(back?.status).toBe('scheduled') // back on the anchor → no longer "moved"
    expect(back?.overridden).toBe(false)
  })

  it('keeps the reservation in sync when an occurrence is rescheduled', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    const session = lesson.sessions[0]!

    const moved = await updateLessonSession(school.orgId, session.id, { startsAt: '2026-09-07T19:00', durationMin: 90 })
    const [res] = await db
      .select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
      .from(reservation)
      .where(eq(reservation.id, session.reservationId))
    expect(res!.startsAt.getTime()).toBe(moved!.startsAt.getTime())
    expect(res!.endsAt.getTime()).toBe(moved!.endsAt.getTime())
    expect(res!.endsAt.getTime() - res!.startsAt.getTime()).toBe(90 * 60_000)
  })

  it('refuses to restore an occurrence of a cancelled series (no zombie)', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    const session = lesson.sessions[0]!

    await cancelSeries(school.orgId, lesson.series.id)
    await expect(restoreLessonSession(school.orgId, session.id))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_SERIES_NOT_ACTIVE' } })
  })

  it('records a durable skip (not a silent gap) when extension hits a court conflict', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(
      school.orgId,
      lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      school.owner.userId
    )
    const sessions = [...lesson.sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    const last = sessions[sessions.length - 1]!

    // Drop the last SESSION but keep its reservation → the court stays occupied at
    // that slot. Pull the horizon back so extend re-expands the occurrence, whose
    // reservation insert then trips the EXCLUDE → a recorded skip, not a loss.
    await db.delete(lessonSession).where(and(eq(lessonSession.organizationId, school.orgId), eq(lessonSession.id, last.id)))
    await db.update(lessonSeriesRule).set({ materializedUntil: last.occurrenceStart }).where(eq(lessonSeriesRule.seriesId, lesson.series.id))

    const result = await extendMaterialization(school.orgId, lesson.series.id)
    expect(result?.created).toBe(0)
    expect(result?.skipped).toBeGreaterThanOrEqual(1)
  })
})

describe.skipIf(!hasTestDb)('materialization sweep', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('rolls due recurring series forward across tenants, ignoring one-offs and cancelled series', async () => {
    const a = await seedSchool()
    const b = await seedSchool()

    // Two tenants, each with a weekly series (past start → materialized from now).
    const ra = await createLesson(a.orgId, lessonBody(a, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }), a.owner.userId)
    const rb = await createLesson(b.orgId, lessonBody(b, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }), b.owner.userId)
    // A one-off (rrule null) and a cancelled recurring series — the sweep must skip
    // BOTH, even once their horizon is pulled below the refill threshold. Placed on
    // the padel court at non-overlapping times so their creation can't conflict.
    const oneOff = await createLesson(a.orgId, {
      type: 'group', sport: 'padel', title: 'One-off', dtStart: '2026-07-13T09:00', durationMin: 60, defaultCourtId: a.padelCourtId
    }, a.owner.userId)
    const cancelled = await createLesson(a.orgId, {
      type: 'group', sport: 'padel', title: 'Cancelled', dtStart: '2020-01-03T12:00', durationMin: 60,
      defaultCourtId: a.padelCourtId, rrule: 'FREQ=WEEKLY;BYDAY=FR'
    }, a.owner.userId)
    await cancelSeries(a.orgId, cancelled.series.id)

    // Give A real work: drop its far-future tail, then pull every series' horizon
    // below the refill threshold (now + 90d) so the sweep considers them "due".
    const soon = new Date(Date.now() + 10 * 86_400_000)
    const tail = await db
      .select({ rid: lessonSession.reservationId })
      .from(lessonSession)
      .where(and(eq(lessonSession.seriesId, ra.series.id), gt(lessonSession.occurrenceStart, soon)))
    await db.delete(reservation).where(inArray(reservation.id, tail.map(t => t.rid))) // cascades to sessions
    const dueSeries = [ra.series.id, rb.series.id, oneOff.series.id, cancelled.series.id]
    // The sweep selects by RULE horizon; pull each rule below the threshold.
    await db.update(lessonSeriesRule).set({ materializedUntil: soon }).where(inArray(lessonSeriesRule.seriesId, dueSeries))

    const result = await runMaterializationSweep()

    expect(result.status).toBe('ok')
    expect(result.processed).toBe(2) // ra + rb only — one-off (no rrule) & cancelled (inactive) excluded
    expect(result.failed).toBe(0)
    expect(result.created).toBeGreaterThan(0) // A's dropped tail re-materialized
    expect(result.capped).toBe(false)

    // A's rule horizon advanced well past the pulled-back point.
    const [after] = await db.select({ mu: lessonSeriesRule.materializedUntil }).from(lessonSeriesRule).where(eq(lessonSeriesRule.seriesId, ra.series.id))
    expect(after!.mu!.getTime()).toBeGreaterThan(soon.getTime())

    // The cancelled series' rule was never touched (horizon stays where we forced it).
    const [cancelledAfter] = await db.select({ mu: lessonSeriesRule.materializedUntil }).from(lessonSeriesRule).where(eq(lessonSeriesRule.seriesId, cancelled.series.id))
    expect(cancelledAfter!.mu!.getTime()).toBe(soon.getTime())
  })

  it('is a no-op when no series has fallen below the refill threshold', async () => {
    const school = await seedSchool()
    // Freshly created → materializedUntil ≈ now + 120d, comfortably above the
    // refill threshold, so nothing is due.
    await createLesson(school.orgId, lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }), school.owner.userId)

    const result = await runMaterializationSweep()
    expect(result.status).toBe('ok')
    expect(result.processed).toBe(0)
    expect(result.created).toBe(0)
  })

  // ── Shared helpers for the rule tests below ────────────────────────────────

  const wide = () => ({ from: new Date(0), to: new Date(Date.now() + 300 * 86_400_000) })
  const warsawHour = (d: Date) => DateTime.fromJSDate(d).setZone('Europe/Warsaw').hour

  // ── Recurrence rules (Phase 1 expand: one rule per series, dual-written) ────

  it('dual-writes one rule per series and stamps ruleId on every session', async () => {
    const school = await seedSchool()
    const created = await createLesson(
      school.orgId,
      lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      school.owner.userId
    )
    const rules = await db.select().from(lessonSeriesRule).where(eq(lessonSeriesRule.seriesId, created.series.id))
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtStart: '2020-01-06T17:00', durationMin: 60,
      courtId: school.courtId, coachMemberId: school.coachMemberId
    })

    const sessions = await db.select({ ruleId: lessonSession.ruleId }).from(lessonSession).where(eq(lessonSession.seriesId, created.series.id))
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every(s => s.ruleId === rules[0]!.id)).toBe(true)
  })

  it('re-times a single-rule group by editing its one slot, re-stamping sessions', async () => {
    const school = await seedSchool()
    const created = await createLesson(
      school.orgId,
      lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      school.owner.userId
    )
    await updateSeriesRule(school.orgId, created.series.id, created.rules[0]!.id, { dtStart: '2020-01-06T09:00', durationMin: 90, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: school.courtId })

    const [rule] = await db.select().from(lessonSeriesRule).where(eq(lessonSeriesRule.seriesId, created.series.id))
    expect(rule).toMatchObject({ dtStart: '2020-01-06T09:00', durationMin: 90 })
    const sessions = await db.select({ ruleId: lessonSession.ruleId, startsAt: lessonSession.startsAt }).from(lessonSession).where(eq(lessonSession.seriesId, created.series.id))
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every(s => s.ruleId === rule!.id)).toBe(true)
    expect(sessions.every(s => warsawHour(s.startsAt) === 9)).toBe(true)
  })

  it('creates a group with multiple rules (Wed 15:00 + Thu 13:00) and tags each session with its rule', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, {
      type: 'group',
      sport: 'tennis',
      title: 'Multi-slot group',
      capacityMax: 8,
      rules: [
        { dtStart: '2020-01-08T15:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: school.courtId, coachMemberId: school.coachMemberId },
        { dtStart: '2020-01-09T13:00', durationMin: 90, rrule: 'FREQ=WEEKLY;BYDAY=TH', courtId: school.courtId }
      ]
    }, school.owner.userId)

    expect(lesson.rules).toHaveLength(2)
    const wedRule = lesson.rules.find(r => r.rrule?.includes('WE'))!
    const thuRule = lesson.rules.find(r => r.rrule?.includes('TH'))!
    expect(thuRule.durationMin).toBe(90)

    const sessions = await db
      .select({ ruleId: lessonSession.ruleId, startsAt: lessonSession.startsAt, endsAt: lessonSession.endsAt })
      .from(lessonSession)
      .where(eq(lessonSession.seriesId, lesson.series.id))
    const wed = sessions.filter(s => s.ruleId === wedRule.id)
    const thu = sessions.filter(s => s.ruleId === thuRule.id)
    expect(wed.length).toBeGreaterThan(0)
    expect(thu.length).toBeGreaterThan(0)
    // Each rule's sessions keep its own local time + duration.
    expect(wed.every(s => warsawHour(s.startsAt) === 15)).toBe(true)
    expect(thu.every(s => warsawHour(s.startsAt) === 13)).toBe(true)
    expect(thu.every(s => s.endsAt.getTime() - s.startsAt.getTime() === 90 * 60_000)).toBe(true)
    // Every session belongs to one of the two rules (nothing orphaned).
    expect(sessions.every(s => s.ruleId === wedRule.id || s.ruleId === thuRule.id)).toBe(true)
  })

  it('runs one group on two courts at the SAME instant (per-rule occurrence key)', async () => {
    const school = await seedSchool()
    const court2 = await createCourt(school.orgId, { name: 'Court 2', sport: 'tennis' }, school.owner.userId)
    // Two slots, identical weekday + time, different courts — the group splits across
    // two courts at the same hour. Both rules produce an occurrence at the same instant;
    // the rule-keyed unique index lets them coexist (the old series-wide key raised a
    // raw 23505 → 500). This create must simply succeed.
    const lesson = await createLesson(school.orgId, {
      type: 'group', sport: 'tennis', title: 'Split group', rules: [
        { dtStart: '2020-01-06T17:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: school.courtId },
        { dtStart: '2020-01-06T17:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: court2.id }
      ]
    }, school.owner.userId)
    expect(lesson.rules).toHaveLength(2)

    const rows = await db
      .select({ ruleId: lessonSession.ruleId, courtId: lessonSession.courtId, occurrenceStart: lessonSession.occurrenceStart })
      .from(lessonSession)
      .where(eq(lessonSession.seriesId, lesson.series.id))
    const court1 = rows.filter(r => r.courtId === school.courtId)
    const court2Rows = rows.filter(r => r.courtId === court2.id)
    expect(court1.length).toBeGreaterThan(0)
    expect(court2Rows.length).toBe(court1.length)
    // The very same occurrence instant is materialized on both courts.
    const court1Instants = new Set(court1.map(r => r.occurrenceStart.getTime()))
    expect(court2Rows.every(r => court1Instants.has(r.occurrenceStart.getTime()))).toBe(true)

    // Adding a third slot at that same instant on a THIRD court also works (the
    // add-slot path is per-rule too); the same instant on an already-busy court
    // would instead be a friendly court conflict.
    const court3 = await createCourt(school.orgId, { name: 'Court 3', sport: 'tennis' }, school.owner.userId)
    const detail = await addSeriesRule(school.orgId, lesson.series.id, {
      dtStart: '2020-01-06T17:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: court3.id
    })
    expect(detail!.rules).toHaveLength(3)
  })

  it('keeps independent per-slot exception ledgers when two slots share an instant', async () => {
    const school = await seedSchool()
    const court2 = await createCourt(school.orgId, { name: 'Court 2', sport: 'tennis' }, school.owner.userId)
    const lesson = await createLesson(school.orgId, {
      type: 'group', sport: 'tennis', title: 'Split group', rules: [
        { dtStart: '2020-01-06T17:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: school.courtId },
        { dtStart: '2020-01-06T17:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: court2.id }
      ]
    }, school.owner.userId)

    const all = (await getSeries(school.orgId, lesson.series.id))!.sessions
    // A pair of sessions on the two courts at the same occurrence instant.
    const target = all.find(s => s.courtId === school.courtId)!
    const sibling = all.find(s => s.courtId === court2.id && s.occurrenceStart.getTime() === target.occurrenceStart.getTime())!
    expect(sibling).toBeDefined()

    await cancelLessonSession(school.orgId, target.id)
    const targetAfter = await getLessonSession(school.orgId, target.id)
    const siblingAfter = await getLessonSession(school.orgId, sibling.id)
    expect(targetAfter!.status).toBe('cancelled')
    expect(siblingAfter!.status).not.toBe('cancelled') // the sibling slot is untouched

    // Exactly one exception at that instant — for the cancelled session's rule only.
    const exceptions = await db
      .select({ ruleId: lessonException.ruleId, sessionId: lessonException.sessionId })
      .from(lessonException)
      .where(and(eq(lessonException.seriesId, lesson.series.id), eq(lessonException.occurrenceStart, target.occurrenceStart)))
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0]!.sessionId).toBe(target.id)
  })

  it('extends every rule of a multi-rule group forward', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, {
      type: 'group',
      sport: 'tennis',
      title: 'Multi-slot group',
      rules: [
        { dtStart: '2020-01-08T15:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: school.courtId },
        { dtStart: '2020-01-09T13:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=TH', courtId: school.courtId }
      ]
    }, school.owner.userId)

    // Pull both rules' horizon back so extend has work on each.
    const soon = new Date(Date.now() + 10 * 86_400_000)
    for (const rule of lesson.rules) {
      const tail = await db
        .select({ rid: lessonSession.reservationId })
        .from(lessonSession)
        .where(and(eq(lessonSession.ruleId, rule.id), gt(lessonSession.occurrenceStart, soon)))
      await db.delete(reservation).where(inArray(reservation.id, tail.map(t => t.rid)))
    }
    await db.update(lessonSeriesRule).set({ materializedUntil: soon }).where(eq(lessonSeriesRule.seriesId, lesson.series.id))

    const result = await extendMaterialization(school.orgId, lesson.series.id)
    expect(result?.created).toBeGreaterThan(0)
    // Both rules materialized ahead again.
    for (const rule of lesson.rules) {
      const [mat] = await db.select({ mu: lessonSeriesRule.materializedUntil }).from(lessonSeriesRule).where(eq(lessonSeriesRule.id, rule.id))
      expect(mat!.mu!.getTime()).toBeGreaterThan(soon.getTime())
    }
  })

  // ── Slot CRUD on an existing group (Phase 3b) ──────────────────────────────

  function twoSlotGroup(school: School) {
    return createLesson(school.orgId, {
      type: 'group', sport: 'tennis', title: 'Multi', rules: [
        { dtStart: '2020-01-08T15:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: school.courtId },
        { dtStart: '2020-01-09T13:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=TH', courtId: school.courtId }
      ]
    }, school.owner.userId)
  }

  it('adds a slot to a group and materializes its occurrences', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }), school.owner.userId)
    const before = await listSessions(school.orgId, wide())

    const detail = await addSeriesRule(school.orgId, lesson.series.id, { dtStart: '2020-01-08T15:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: school.courtId })
    expect(detail!.rules).toHaveLength(2)

    const after = await listSessions(school.orgId, wide())
    expect(after.length).toBeGreaterThan(before.length)
    expect(after.some(s => warsawHour(s.startsAt) === 15)).toBe(true) // the new Wednesday slot
  })

  it('edits one slot, re-timing only that slot and leaving the others', async () => {
    const school = await seedSchool()
    const lesson = await twoSlotGroup(school)
    const wedRule = lesson.rules.find(r => r.rrule?.includes('WE'))!
    const thuRule = lesson.rules.find(r => r.rrule?.includes('TH'))!

    await updateSeriesRule(school.orgId, lesson.series.id, wedRule.id, { dtStart: '2020-01-08T16:00', durationMin: 90, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: school.courtId })

    const sessions = await db
      .select({ ruleId: lessonSession.ruleId, startsAt: lessonSession.startsAt, endsAt: lessonSession.endsAt })
      .from(lessonSession)
      .where(eq(lessonSession.seriesId, lesson.series.id))
    const wed = sessions.filter(s => s.ruleId === wedRule.id)
    const thu = sessions.filter(s => s.ruleId === thuRule.id)
    expect(wed.every(s => warsawHour(s.startsAt) === 16)).toBe(true)
    expect(wed.every(s => s.endsAt.getTime() - s.startsAt.getTime() === 90 * 60_000)).toBe(true)
    expect(thu.every(s => warsawHour(s.startsAt) === 13)).toBe(true) // untouched
  })

  it('removes a slot (future gone) and refuses removing the only slot', async () => {
    const school = await seedSchool()
    const lesson = await twoSlotGroup(school)
    const wedRule = lesson.rules.find(r => r.rrule?.includes('WE'))!

    const detail = await removeSeriesRule(school.orgId, lesson.series.id, wedRule.id)
    expect(detail!.rules).toHaveLength(1)
    const remaining = await db
      .select({ ruleId: lessonSession.ruleId })
      .from(lessonSession)
      .where(and(eq(lessonSession.seriesId, lesson.series.id), gt(lessonSession.startsAt, new Date())))
    expect(remaining.every(s => s.ruleId !== wedRule.id)).toBe(true)

    await expect(removeSeriesRule(school.orgId, lesson.series.id, detail!.rules[0]!.id))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_LAST_RULE' } })
  })

  it('never adds/edits/removes slots on another tenant’s group', async () => {
    const a = await seedSchool()
    const b = await seedSchool()
    const lesson = await twoSlotGroup(a)
    const ruleId = lesson.rules[0]!.id
    const rule = { dtStart: '2020-01-08T15:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: b.courtId }
    expect(await addSeriesRule(b.orgId, lesson.series.id, rule)).toBeNull()
    expect(await updateSeriesRule(b.orgId, lesson.series.id, ruleId, rule)).toBeNull()
    expect(await removeSeriesRule(b.orgId, lesson.series.id, ruleId)).toBeNull()
  })

  it('preserves group enrolments across a slot edit', async () => {
    const school = await seedSchool()
    const created = await createLesson(school.orgId, lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }), school.owner.userId)
    await enrollInSeries(school.orgId, created.series.id, school.studentMemberId)

    await updateSeriesRule(school.orgId, created.series.id, created.rules[0]!.id, { dtStart: '2020-01-06T18:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=WE', courtId: school.courtId })

    const list = await listSeriesEnrollments(school.orgId, created.series.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ studentMemberId: school.studentMemberId, status: 'enrolled' })
  })

  it('keeps a slot’s past sessions as history when re-timing it', async () => {
    const school = await seedSchool()
    const created = await createLesson(school.orgId, lessonBody(school, { dtStart: '2020-01-06T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' }), school.owner.userId)
    const ruleId = created.rules[0]!.id
    // A session that already happened, on that rule.
    const past = new Date(Date.now() - 7 * 86_400_000)
    const resId = randomUUID()
    const sessId = randomUUID()
    await db.insert(reservation).values({ id: resId, organizationId: school.orgId, courtId: school.courtId, startsAt: past, endsAt: new Date(past.getTime() + 3_600_000), status: 'confirmed', kind: 'lesson', createdBy: school.owner.userId })
    await db.insert(lessonSession).values({ id: sessId, organizationId: school.orgId, seriesId: created.series.id, ruleId, reservationId: resId, occurrenceStart: past, startsAt: past, endsAt: new Date(past.getTime() + 3_600_000), coachMemberId: school.coachMemberId, courtId: school.courtId, status: 'scheduled', overridden: false })

    await updateSeriesRule(school.orgId, created.series.id, ruleId, { dtStart: '2020-01-06T08:00', durationMin: 60, rrule: 'FREQ=WEEKLY;BYDAY=MO', courtId: school.courtId })

    const [survivor] = await db.select({ id: lessonSession.id }).from(lessonSession).where(and(eq(lessonSession.organizationId, school.orgId), eq(lessonSession.id, sessId)))
    expect(survivor).toBeDefined()
  })

  it('rejects re-timing a one-off slot into the past, and a slot edit that double-books', async () => {
    const school = await seedSchool()
    // A one-off at 17:00 (occupies that slot on the tennis court).
    const oneOff = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T17:00' }), school.owner.userId)
    await expect(updateSeriesRule(school.orgId, oneOff.series.id, oneOff.rules[0]!.id, { dtStart: '2020-01-01T10:00', durationMin: 60, courtId: school.courtId }))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_DTSTART_PAST' } })

    // A second lesson at 19:00; moving its slot onto the one-off's 17:00 conflicts.
    const b = await createLesson(school.orgId, lessonBody(school, { dtStart: '2026-09-07T19:00', title: 'B' }), school.owner.userId)
    await expect(updateSeriesRule(school.orgId, b.series.id, b.rules[0]!.id, { dtStart: '2026-09-07T17:00', durationMin: 60, courtId: school.courtId }))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'SCHEDULE_COURT_CONFLICT' } })
  })
})
