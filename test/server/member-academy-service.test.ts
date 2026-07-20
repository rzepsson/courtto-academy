import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getMemberAcademy } from '../../server/utils/services/memberAcademy'
import { createLesson } from '../../server/utils/services/schedule'
import { enrollInSeries, markAttendance } from '../../server/utils/services/enrollment'
import { createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { addMember, createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

interface School {
  owner: SeededUser
  orgId: string
  courtId: string
  coachMemberId: string
  studentMemberId: string
}

async function seedSchool(): Promise<School> {
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${randomUUID().slice(0, 8)}` })
  await upsertOrgProfile(orgId, { sports: ['tennis'], timezone: 'Europe/Warsaw' })
  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)

  const coachUser = await signUp()
  const coachMemberId = await addMember(orgId, coachUser.userId, 'coach')
  const studentUser = await signUp()
  const studentMemberId = await addMember(orgId, studentUser.userId, 'student')

  return { owner, orgId, courtId: court.id, coachMemberId, studentMemberId }
}

// One 60-minute tennis lesson on a fixed future date, taught by the school's coach.
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

// A window that contains the seeded 2026-09-07 lesson.
const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') }

describe.skipIf(!hasTestDb)('member academy service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('reports a coach’s teaching load and the groups they teach', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school), school.owner.userId)

    const academy = await getMemberAcademy(school.orgId, school.coachMemberId, RANGE)

    expect(academy?.learning).toBeNull() // a coach never has a learning lens
    expect(academy?.teaching).toMatchObject({ minutes: 60, sessionCount: 1 })
    expect(academy?.teaching?.groups).toHaveLength(1)
    expect(academy?.teaching?.groups[0]).toMatchObject({ title: 'Grupa A', sport: 'tennis', sessionCount: 1, minutes: 60 })
    // The heatmap is the shared 168-cell grid, peaking at the lesson's local hour.
    expect(academy?.teaching?.heatmap).toHaveLength(168)
    expect(academy?.teaching?.peakBucket).toMatchObject({ hour: 17, minutes: 60 })
  })

  it('reports a student’s training hours, groups and attendance rate', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    await enrollInSeries(school.orgId, lesson.series.id, school.studentMemberId)
    await markAttendance(school.orgId, lesson.sessions[0]!.id, [
      { studentMemberId: school.studentMemberId, status: 'present' }
    ])

    const academy = await getMemberAcademy(school.orgId, school.studentMemberId, RANGE)

    expect(academy?.teaching).toBeNull() // a student never has a teaching lens
    expect(academy?.learning).toMatchObject({ minutes: 60, sessionCount: 1 })
    expect(academy?.learning?.groups[0]).toMatchObject({ title: 'Grupa A', enrollmentStatus: 'enrolled' })
    expect(academy?.learning?.attendance).toMatchObject({ present: 1, absent: 0, excused: 0, late: 0 })
    expect(academy?.learning?.attendanceRate).toBe(100)
  })

  it('gives an owner who coaches a teaching lens — the capability, not the role, decides', async () => {
    const school = await seedSchool()
    // The owner's own membership id, via a member they can act on: resolve through
    // the academy of the coach is not enough, so grant the capability to an admin.
    const adminUser = await signUp()
    const adminMemberId = await addMember(school.orgId, adminUser.userId, 'admin')

    // Without the capability an admin has no lens at all.
    const before = await getMemberAcademy(school.orgId, adminMemberId, RANGE)
    expect(before?.teaching).toBeNull()
    expect(before?.learning).toBeNull()

    // Granting it (and assigning a lesson) turns the teaching lens on.
    await upsertMemberProfile(school.orgId, adminMemberId, { canCoach: true })
    await createLesson(school.orgId, lessonBody(school, { coachMemberId: adminMemberId }), school.owner.userId)

    const after = await getMemberAcademy(school.orgId, adminMemberId, RANGE)
    expect(after?.teaching).toMatchObject({ minutes: 60, sessionCount: 1 })
  })

  it('excludes lessons outside the window and never reads another tenant', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school), school.owner.userId)

    // A window before the lesson → no load, but the lens still exists.
    const empty = await getMemberAcademy(school.orgId, school.coachMemberId, {
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z')
    })
    expect(empty?.teaching).toMatchObject({ minutes: 0, sessionCount: 0 })
    expect(empty?.teaching?.groups).toEqual([])

    // Another school can't read this member at all.
    const other = await seedSchool()
    expect(await getMemberAcademy(other.orgId, school.coachMemberId, RANGE)).toBeNull()
  })
})
