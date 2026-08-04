import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cancelLessonSession, createLesson, updateLessonSession } from '../../server/utils/services/schedule'
import { cancelEnrollment, enrollInSeries } from '../../server/utils/services/enrollment'
import { runLessonReminderSweep } from '../../server/utils/services/lessonNotifications'
import { getNotificationFeed } from '../../server/utils/services/notifications'
import { createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { createMemberGuardian } from '../../server/utils/services/memberGuardians'
import { clearMailTransport, setMailTransport, type OutgoingMail } from '../../server/utils/mailer'
import { addMember, createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>
const outbox: OutgoingMail[] = []

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

let orgSeq = 0

interface School {
  owner: SeededUser
  orgId: string
  courtId: string
  coach: { user: SeededUser, memberId: string }
}

async function seedSchool(locale: 'en' | 'pl' = 'en'): Promise<School> {
  orgSeq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${orgSeq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis'], timezone: 'Europe/Warsaw', locale })
  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
  const coachUser = await signUp()
  const coachMemberId = await addMember(orgId, coachUser.userId, 'coach')
  return { owner, orgId, courtId: court.id, coach: { user: coachUser, memberId: coachMemberId } }
}

// A student; when `dob`/`guardianEmail` are given, a minor with a primary guardian.
async function addStudent(orgId: string, opts: { dob?: string, guardianEmail?: string } = {}): Promise<{ user: SeededUser, memberId: string }> {
  const user = await signUp()
  const memberId = await addMember(orgId, user.userId, 'student')
  if (opts.dob) await upsertMemberProfile(orgId, memberId, { dateOfBirth: opts.dob })
  if (opts.guardianEmail) {
    await createMemberGuardian(orgId, memberId, {
      name: 'Parent',
      relationship: 'mother',
      phone: '',
      email: opts.guardianEmail,
      isPrimary: true,
      notes: ''
    })
  }
  return { user, memberId }
}

function makeLesson(school: School, overrides: Record<string, unknown> = {}) {
  return createLesson(school.orgId, {
    type: 'group',
    sport: 'tennis',
    title: 'Junior Group',
    dtStart: '2026-09-07T17:00',
    durationMin: 60,
    defaultCourtId: school.courtId,
    coachMemberId: school.coach.memberId,
    ...overrides
  }, school.owner.userId)
}

const MINOR_DOB = '2015-01-01'

describe.skipIf(!hasTestDb)('lesson notifications', () => {
  beforeEach(async () => {
    await resetDb()
    outbox.length = 0
    setMailTransport({
      name: 'recording',
      async send(mail) {
        outbox.push(mail)
      }
    })
  })

  afterAll(() => {
    clearMailTransport()
  })

  it('notifies enrolled students, the coach and a minor’s guardian when a session is cancelled', async () => {
    const school = await seedSchool('en')
    const adult = await addStudent(school.orgId)
    const minor = await addStudent(school.orgId, { dob: MINOR_DOB, guardianEmail: 'parent@example.com' })
    const lesson = await makeLesson(school)
    await enrollInSeries(school.orgId, lesson.series.id, adult.memberId)
    await enrollInSeries(school.orgId, lesson.series.id, minor.memberId)

    outbox.length = 0
    const session = lesson.sessions[0]!
    await cancelLessonSession(school.orgId, session.id, 'Coach ill')

    // Email: both students, the guardian, and the coach — four addresses.
    expect(outbox.map(m => m.to).sort()).toEqual(
      [adult.user.email, minor.user.email, 'parent@example.com', school.coach.user.email].sort()
    )
    expect(outbox.every(m => m.subject === 'Cancelled: Junior Group')).toBe(true)
    // The reason rides the body.
    expect(outbox.find(m => m.to === adult.user.email)!.text).toContain('Coach ill')

    // Bell: account-holders get a row; the guardian (no account) does not.
    const adultFeed = await getNotificationFeed(adult.user.userId, school.orgId)
    expect(adultFeed.notifications.some(n => n.type === 'lesson.cancelled')).toBe(true)
    const coachFeed = await getNotificationFeed(school.coach.user.userId, school.orgId)
    expect(coachFeed.notifications.some(n => n.type === 'lesson.cancelled')).toBe(true)
  })

  it('notifies on a time change but not on a metadata-only edit', async () => {
    const school = await seedSchool('en')
    const student = await addStudent(school.orgId)
    const lesson = await makeLesson(school)
    await enrollInSeries(school.orgId, lesson.series.id, student.memberId)
    const session = lesson.sessions[0]!

    // A no-op edit (no time change) emits nothing.
    outbox.length = 0
    await updateLessonSession(school.orgId, session.id, {})
    expect(outbox).toHaveLength(0)

    // Moving the occurrence emits a reschedule to the student + coach.
    await updateLessonSession(school.orgId, session.id, { startsAt: '2026-09-07T19:00' })
    expect(outbox.map(m => m.to).sort()).toEqual([student.user.email, school.coach.user.email].sort())
    expect(outbox.every(m => m.subject === 'Rescheduled: Junior Group')).toBe(true)
    const feed = await getNotificationFeed(student.user.userId, school.orgId)
    expect(feed.notifications.some(n => n.type === 'lesson.rescheduled')).toBe(true)
  })

  it('notifies the promoted student (and their guardian) when a seat frees on the waitlist', async () => {
    const school = await seedSchool('en')
    const s1 = await addStudent(school.orgId)
    const s2 = await addStudent(school.orgId, { dob: MINOR_DOB, guardianEmail: 'p2@example.com' })
    const lesson = await makeLesson(school, { capacityMax: 1 })

    const e1 = await enrollInSeries(school.orgId, lesson.series.id, s1.memberId)
    const e2 = await enrollInSeries(school.orgId, lesson.series.id, s2.memberId)
    expect(e1?.status).toBe('enrolled')
    expect(e2?.status).toBe('waitlisted')

    outbox.length = 0
    await cancelEnrollment(school.orgId, e1!.id) // frees the seat → promotes s2

    // Only s2 (+ their guardian) is told — not the whole class.
    expect(outbox.map(m => m.to).sort()).toEqual([s2.user.email, 'p2@example.com'].sort())
    const feed = await getNotificationFeed(s2.user.userId, school.orgId)
    expect(feed.notifications.some(n => n.type === 'enrollment.waitlist_promoted')).toBe(true)
  })

  it('reminds each upcoming lesson exactly once (idempotent across sweeps)', async () => {
    const school = await seedSchool('en')
    const s1 = await addStudent(school.orgId)
    const s2 = await addStudent(school.orgId, { dob: MINOR_DOB, guardianEmail: 'guardian@example.com' })
    const lesson = await makeLesson(school)
    await enrollInSeries(school.orgId, lesson.series.id, s1.memberId)
    await enrollInSeries(school.orgId, lesson.series.id, s2.memberId)

    outbox.length = 0
    const startsAt = lesson.sessions[0]!.startsAt
    const now = new Date(startsAt.getTime() - 60 * 60 * 1000) // 1h before the lesson

    const first = await runLessonReminderSweep(now)
    expect(first.reminded).toBe(2) // two students (guardians/coach aren't counted)
    // Emails: both students + the minor's guardian.
    expect(outbox.map(m => m.to).sort()).toEqual([s1.user.email, s2.user.email, 'guardian@example.com'].sort())
    expect(outbox.every(m => m.subject === 'Reminder: Junior Group')).toBe(true)

    // A second sweep in the same window sends nothing — the per-(session, student)
    // dedupe makes it a no-op.
    outbox.length = 0
    const second = await runLessonReminderSweep(now)
    expect(second.reminded).toBe(0)
    expect(outbox).toHaveLength(0)
  })

  it('never notifies across tenants — a cancel scoped to the wrong org is a no-op', async () => {
    const school = await seedSchool('en')
    const student = await addStudent(school.orgId)
    const lesson = await makeLesson(school)
    await enrollInSeries(school.orgId, lesson.series.id, student.memberId)
    const other = await seedSchool('en')

    outbox.length = 0
    // The session isn't org B's, so this resolves to null and emits nothing.
    expect(await cancelLessonSession(other.orgId, lesson.sessions[0]!.id)).toBeNull()
    expect(outbox).toHaveLength(0)
  })

  it('writes the emails in the school locale', async () => {
    const school = await seedSchool('pl')
    const student = await addStudent(school.orgId)
    const lesson = await makeLesson(school)
    await enrollInSeries(school.orgId, lesson.series.id, student.memberId)

    outbox.length = 0
    await cancelLessonSession(school.orgId, lesson.sessions[0]!.id)
    expect(outbox.find(m => m.to === student.user.email)!.subject).toBe('Odwołane: Junior Group')
  })
})
