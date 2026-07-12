import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelEnrollment,
  enrollInSeries,
  enrollInSession,
  getSessionRoster,
  listSeriesEnrollments,
  listStudentSessions,
  markAttendance
} from '../../server/utils/services/enrollment'
import { createLesson } from '../../server/utils/services/schedule'
import { createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { addMember, createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

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
  coachMemberId: string
}

async function seedSchool(): Promise<School> {
  orgSeq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${orgSeq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis'], timezone: 'Europe/Warsaw' })
  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
  const coachUser = await signUp()
  const coachMemberId = await addMember(orgId, coachUser.userId, 'coach')
  return { owner, orgId, courtId: court.id, coachMemberId }
}

async function makeStudent(orgId: string): Promise<string> {
  const user = await signUp()
  return addMember(orgId, user.userId, 'student')
}

async function makeCoach(orgId: string): Promise<string> {
  const user = await signUp()
  return addMember(orgId, user.userId, 'coach')
}

function makeLesson(school: School, overrides: Record<string, unknown> = {}) {
  return createLesson(school.orgId, {
    type: 'group',
    sport: 'tennis',
    title: 'Grupa',
    dtStart: '2026-09-07T17:00',
    durationMin: 60,
    defaultCourtId: school.courtId,
    coachMemberId: school.coachMemberId,
    ...overrides
  }, school.owner.userId)
}

describe.skipIf(!hasTestDb)('enrolment + attendance service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('enrols within capacity, waitlists beyond it, and promotes the queue on cancel', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const s2 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school, { capacityMax: 1 })

    const e1 = await enrollInSeries(school.orgId, lesson.series.id, s1)
    expect(e1?.status).toBe('enrolled')

    const e2 = await enrollInSeries(school.orgId, lesson.series.id, s2)
    expect(e2?.status).toBe('waitlisted')
    expect(e2?.waitlistPos).toBe(1)

    // Cancelling the enrolled seat promotes the first waitlisted student.
    await cancelEnrollment(school.orgId, e1!.id)
    const list = await listSeriesEnrollments(school.orgId, lesson.series.id)
    expect(list.find(r => r.studentMemberId === s2)?.status).toBe('enrolled')
  })

  it('is idempotent while active and re-activates a cancelled enrolment', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school)

    const e1 = await enrollInSeries(school.orgId, lesson.series.id, s1)
    const again = await enrollInSeries(school.orgId, lesson.series.id, s1)
    expect(again?.id).toBe(e1!.id) // same row, no duplicate

    await cancelEnrollment(school.orgId, e1!.id)
    const reactivated = await enrollInSeries(school.orgId, lesson.series.id, s1)
    expect(reactivated?.id).toBe(e1!.id)
    expect(reactivated?.status).toBe('enrolled')
  })

  it('rejects enrolment when closed, when the series is cancelled, and for a non-member', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)

    const closed = await makeLesson(school, { enrollmentOpen: false })
    await expect(enrollInSeries(school.orgId, closed.series.id, s1))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_ENROLLMENT_CLOSED' } })

    // A different slot so the two lessons don't collide on the court.
    const open = await makeLesson(school, { dtStart: '2026-09-07T19:00' })
    await expect(enrollInSeries(school.orgId, open.series.id, 'no-such-member'))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_STUDENT_NOT_FOUND' } })
  })

  it('drop-in counts series enrolees against the session capacity, and rejects a double enrol', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const s2 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school, { capacityMax: 1, rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    const session = lesson.sessions[0]!

    await enrollInSeries(school.orgId, lesson.series.id, s1) // fills the group

    // A series enrolee can't also drop into their own series' session.
    await expect(enrollInSession(school.orgId, session.id, s1))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_ALREADY_ENROLLED' } })

    // A different student dropping in is waitlisted — the series enrolee took the seat.
    const drop = await enrollInSession(school.orgId, session.id, s2)
    expect(drop?.status).toBe('waitlisted')
  })

  it('builds a roster from series + drop-in enrolees and records attendance (upsert)', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const s2 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school, { rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    const session = lesson.sessions[0]!

    await enrollInSeries(school.orgId, lesson.series.id, s1)
    await enrollInSession(school.orgId, session.id, s2)

    const roster0 = await getSessionRoster(school.orgId, session.id)
    expect(roster0).toHaveLength(2)
    expect(roster0!.find(r => r.studentMemberId === s1)?.source).toBe('series')
    expect(roster0!.find(r => r.studentMemberId === s2)?.source).toBe('session')
    expect(roster0!.every(r => r.attendanceStatus === null)).toBe(true)

    const marked = await markAttendance(school.orgId, session.id, [
      { studentMemberId: s1, status: 'present' },
      { studentMemberId: s2, status: 'excused' }
    ], school.coachMemberId)
    expect(marked!.find(r => r.studentMemberId === s1)?.attendanceStatus).toBe('present')
    expect(marked!.find(r => r.studentMemberId === s2)?.attendanceStatus).toBe('excused')

    // Re-marking upserts, not duplicates.
    const remarked = await markAttendance(school.orgId, session.id, [{ studentMemberId: s1, status: 'absent' }], school.coachMemberId)
    expect(remarked!.find(r => r.studentMemberId === s1)?.attendanceStatus).toBe('absent')
  })

  it('lets a coach mark only their own session, rejects invalid statuses and non-enrolled students', async () => {
    const school = await seedSchool()
    const otherCoach = await makeCoach(school.orgId)
    const lesson = await makeLesson(school) // coach = school.coachMemberId
    const session = lesson.sessions[0]!
    const s1 = await makeStudent(school.orgId)
    await enrollInSeries(school.orgId, lesson.series.id, s1)

    // A foreign coach can't mark this session.
    await expect(markAttendance(school.orgId, session.id, [{ studentMemberId: s1, status: 'present' }], otherCoach, otherCoach))
      .rejects.toMatchObject({ statusCode: 403, data: { code: 'SCHEDULE_ATTENDANCE_FORBIDDEN' } })

    // The owning coach can.
    const ok = await markAttendance(school.orgId, session.id, [{ studentMemberId: s1, status: 'present' }], school.coachMemberId, school.coachMemberId)
    expect(ok).not.toBeNull()

    await expect(markAttendance(school.orgId, session.id, [{ studentMemberId: s1, status: 'maybe' }], school.coachMemberId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_ATTENDANCE_INVALID' } })

    // A student who isn't enrolled in the session can't be marked.
    const outsider = await makeStudent(school.orgId)
    await expect(markAttendance(school.orgId, session.id, [{ studentMemberId: outsider, status: 'present' }], school.coachMemberId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'SCHEDULE_STUDENT_NOT_FOUND' } })
  })

  it('does not over-promote: a double-cancel and a waitlisted-cancel free no extra seat', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const s2 = await makeStudent(school.orgId)
    const s3 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school, { capacityMax: 1 })

    const e1 = await enrollInSeries(school.orgId, lesson.series.id, s1) // enrolled
    const e2 = await enrollInSeries(school.orgId, lesson.series.id, s2) // waitlisted pos 1
    await enrollInSeries(school.orgId, lesson.series.id, s3) // waitlisted pos 2

    // Cancelling a WAITLISTED enrolment frees no seat → no promotion.
    await cancelEnrollment(school.orgId, e2!.id)
    let list = await listSeriesEnrollments(school.orgId, lesson.series.id)
    expect(list.filter(r => r.status === 'enrolled').map(r => r.studentMemberId)).toEqual([s1])

    // Cancel the enrolled seat → exactly one promotion (s3, the remaining waitlister).
    await cancelEnrollment(school.orgId, e1!.id)
    // Re-cancelling the already-cancelled seat must NOT promote anyone else.
    await cancelEnrollment(school.orgId, e1!.id)
    list = await listSeriesEnrollments(school.orgId, lesson.series.id)
    expect(list.filter(r => r.status === 'enrolled').map(r => r.studentMemberId)).toEqual([s3])
  })

  it('includes a drop-in session in the student’s own schedule', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school, { dtStart: '2026-09-07T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    const session = lesson.sessions[0]!
    await enrollInSession(school.orgId, session.id, s1) // drop-in, not a series enrolment

    const sessions = await listStudentSessions(school.orgId, s1, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z')
    })
    const dropIn = sessions.find(s => s.id === session.id)
    expect(dropIn).toBeDefined()
    expect(dropIn?.enrollmentStatus).toBe('enrolled')
  })

  it('lists a student’s own sessions with their enrolment status', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school, { dtStart: '2026-09-07T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    await enrollInSeries(school.orgId, lesson.series.id, s1)

    const sessions = await listStudentSessions(school.orgId, s1, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2027-06-01T00:00:00Z')
    })
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every(s => s.enrollmentStatus === 'enrolled')).toBe(true)
    expect(sessions[0]!.seriesTitle).toBe('Grupa')

    // A different student sees none of them.
    const s2 = await makeStudent(school.orgId)
    const none = await listStudentSessions(school.orgId, s2, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2027-06-01T00:00:00Z')
    })
    expect(none).toHaveLength(0)
  })

  it('lets a student cancel only their own enrolment', async () => {
    const school = await seedSchool()
    const s1 = await makeStudent(school.orgId)
    const s2 = await makeStudent(school.orgId)
    const lesson = await makeLesson(school)
    const e1 = await enrollInSeries(school.orgId, lesson.series.id, s1)

    // s2 can't cancel s1's enrolment — treated as not found.
    expect(await cancelEnrollment(school.orgId, e1!.id, s2)).toBeNull()

    const cancelled = await cancelEnrollment(school.orgId, e1!.id, s1)
    expect(cancelled?.status).toBe('cancelled')
  })

  it('never enrols, rosters or cancels across tenants', async () => {
    const a = await seedSchool()
    const b = await seedSchool()
    const sA = await makeStudent(a.orgId)
    const sB = await makeStudent(b.orgId)
    const lessonA = await makeLesson(a)
    const eA = await enrollInSeries(a.orgId, lessonA.series.id, sA)

    expect(await enrollInSeries(b.orgId, lessonA.series.id, sB)).toBeNull()
    expect(await getSessionRoster(b.orgId, lessonA.sessions[0]!.id)).toBeNull()
    expect(await cancelEnrollment(b.orgId, eA!.id)).toBeNull()

    // A's enrolment is intact.
    const listA = await listSeriesEnrollments(a.orgId, lessonA.series.id)
    expect(listA).toHaveLength(1)
    expect(listA[0]!.status).toBe('enrolled')
  })
})
