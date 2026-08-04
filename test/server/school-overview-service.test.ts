import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { getSchoolOverview } from '../../server/utils/services/schoolOverview'
import { createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { db } from '../../server/utils/db'
import { reservation } from '../../server/database/app-schema'
import { addMember, createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

let seq = 0
interface School { owner: SeededUser, orgId: string, courtId: string }

async function seedSchool(): Promise<School> {
  seq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${seq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis'], timezone: 'Europe/Warsaw' })
  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
  return { owner, orgId, courtId: court.id }
}

// A usage reservation today 08:00–09:00 in the school's timezone — always inside
// both the rolling 7-day window and the operating hours (07–23), so occupancy is
// deterministic regardless of when the suite runs. Direct write to the app-owned
// reservation table (like the utilization tests seed via the schedule service).
async function seedTodayLesson(school: School): Promise<void> {
  const start = DateTime.now().setZone('Europe/Warsaw').startOf('day').set({ hour: 8 })
  await db.insert(reservation).values({
    id: `res_${Date.now()}_${seq}_${Math.random().toString(36).slice(2)}`,
    organizationId: school.orgId,
    courtId: school.courtId,
    startsAt: start.toJSDate(),
    endsAt: start.plus({ hours: 1 }).toJSDate(),
    status: 'confirmed',
    kind: 'lesson'
  })
}

describe.skipIf(!hasTestDb)('school overview service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('assembles a fresh school with sensible zero-state counts', async () => {
    const school = await seedSchool()
    const overview = await getSchoolOverview(school.orgId)

    expect(overview.counts).toEqual({ students: 0, coaches: 0, staff: 1, courts: 1 })
    expect(overview.week.lessonCount).toBe(0)
    expect(overview.week.occupancyPct).toBe(0)
    expect(overview.today.sessions).toEqual([])
    expect(overview.activity).toEqual([])
    expect(overview.timezone).toBe('Europe/Warsaw')
  })

  it('counts active students and coaches (capability, not just role)', async () => {
    const school = await seedSchool()
    const coach = await signUp({ email: uniqueEmail('coach') })
    await addMember(school.orgId, coach.userId, 'coach')
    const student = await signUp({ email: uniqueEmail('student') })
    await addMember(school.orgId, student.userId, 'student')

    const overview = await getSchoolOverview(school.orgId)
    expect(overview.counts.students).toBe(1)
    expect(overview.counts.coaches).toBe(1)
    expect(overview.counts.staff).toBe(1)
  })

  it('reflects a lesson in the weekly occupancy', async () => {
    const school = await seedSchool()
    await seedTodayLesson(school)

    const overview = await getSchoolOverview(school.orgId)
    expect(overview.week.lessonCount).toBe(1)
    expect(overview.week.lessonHours).toBeCloseTo(1, 5)
    expect(overview.week.occupancyPct).toBeGreaterThan(0)
    expect(overview.week.peakBucket).not.toBeNull()
  })

  it('is tenant-scoped — another school\'s lessons and members never leak in', async () => {
    const school = await seedSchool()
    const other = await seedSchool()
    await seedTodayLesson(other)
    const otherCoach = await signUp({ email: uniqueEmail('coach') })
    await addMember(other.orgId, otherCoach.userId, 'coach')

    const overview = await getSchoolOverview(school.orgId)
    expect(overview.counts.coaches).toBe(0)
    expect(overview.week.lessonCount).toBe(0)
    expect(overview.week.occupancyPct).toBe(0)
  })
})
