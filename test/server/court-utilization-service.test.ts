import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getCourtUtilization } from '../../server/utils/services/courtUtilization'
import { createCourtBlock } from '../../server/utils/services/courtBlocks'
import { createLesson } from '../../server/utils/services/schedule'
import { createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { heatmapCell } from '../../app/utils/utilization'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'
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

const FROM = new Date('2026-07-13T00:00:00.000Z')
const TO = new Date('2026-07-20T00:00:00.000Z')

describe.skipIf(!hasTestDb)('court utilization service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('splits usage (lessons) from downtime (blocks) and buckets the demand heatmap', async () => {
    const school = await seedSchool()
    // A 90-min lesson Wed 2026-07-15 17:00–18:30 local.
    await createLesson(school.orgId, {
      type: 'group', sport: 'tennis', title: 'Grupa A',
      dtStart: '2026-07-15T17:00', durationMin: 90, defaultCourtId: school.courtId
    }, school.owner.userId)
    // A 2-hour maintenance block Thu 2026-07-16 09:00–11:00 local.
    await createCourtBlock(school.orgId, school.courtId, { startLocal: '2026-07-16T09:00', endLocal: '2026-07-16T11:00' }, school.owner.userId)

    const util = await getCourtUtilization(school.orgId, school.courtId, FROM, TO)
    expect(util.usageMinutes).toBe(90)
    expect(util.usageCount).toBe(1)
    expect(util.downtimeMinutes).toBe(120)
    // Wed (index 2) 17:00 gets the hour, 18:00 the half.
    expect(heatmapCell(util.heatmap, 2, 17)).toBe(60)
    expect(heatmapCell(util.heatmap, 2, 18)).toBe(30)
    expect(util.peakBucket).toEqual({ weekday: 2, hour: 17, minutes: 60 })
    expect(util.utilizationPct).toBeGreaterThan(0)
    expect(util.timezone).toBe('Europe/Warsaw')
  })

  it('is tenant-scoped — another facility sees none of this court', async () => {
    const school = await seedSchool()
    const other = await seedSchool()
    await createLesson(school.orgId, {
      type: 'group', sport: 'tennis', title: 'Grupa A',
      dtStart: '2026-07-15T17:00', durationMin: 90, defaultCourtId: school.courtId
    }, school.owner.userId)

    const util = await getCourtUtilization(other.orgId, school.courtId, FROM, TO)
    expect(util.usageMinutes).toBe(0)
    expect(util.usageCount).toBe(0)
    expect(util.peakBucket).toBeNull()
  })
})
