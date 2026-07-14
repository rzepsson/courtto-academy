import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  createZone,
  deleteZone,
  listZones,
  reorderZones,
  updateZone,
  zoneBelongsToOrg
} from '../../server/utils/services/courtZones'
import { archiveCourt, createCourt, getCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { db } from '../../server/utils/db'
import { court } from '../../server/database/app-schema'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

// The service reaches for `createError` as a Nuxt server auto-import; provide it
// so we exercise the real validation/isolation/uniqueness logic against Postgres.
const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

let seq = 0
async function seedFacility(): Promise<{ owner: SeededUser, orgId: string }> {
  seq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${seq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis', 'padel'] })
  return { owner, orgId }
}

describe.skipIf(!hasTestDb)('court zones service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates zones in order and lists them with their active court counts', async () => {
    const { owner, orgId } = await seedFacility()
    const a = await createZone(orgId, { name: 'Hall A' }, owner.userId)
    const b = await createZone(orgId, { name: 'Hall B' }, owner.userId)
    expect(a.sortOrder).toBe(0)
    expect(b.sortOrder).toBe(1)
    expect(a.courtCount).toBe(0)

    // Two active courts + one archived in Hall A → count is the active ones only.
    await createCourt(orgId, { name: 'Court 1', sport: 'tennis', zoneId: a.id }, owner.userId)
    await createCourt(orgId, { name: 'Court 2', sport: 'tennis', zoneId: a.id }, owner.userId)
    const archived = await createCourt(orgId, { name: 'Court 3', sport: 'tennis', zoneId: a.id }, owner.userId)
    await archiveCourt(orgId, archived.id)

    const zones = await listZones(orgId)
    expect(zones.map(z => z.id)).toEqual([a.id, b.id])
    expect(zones[0]!.courtCount).toBe(2)
    expect(zones[1]!.courtCount).toBe(0)
  })

  it('rejects a case-insensitively duplicate name', async () => {
    const { owner, orgId } = await seedFacility()
    await createZone(orgId, { name: 'Hall A' }, owner.userId)
    await expect(createZone(orgId, { name: 'hall a' }, owner.userId))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'COURT_ZONE_NAME_TAKEN' } })
  })

  it('renames a zone', async () => {
    const { owner, orgId } = await seedFacility()
    const zone = await createZone(orgId, { name: 'Hall A' }, owner.userId)
    const renamed = await updateZone(orgId, zone.id, { name: 'Main Hall' })
    expect(renamed?.name).toBe('Main Hall')
  })

  it('reorders zones', async () => {
    const { owner, orgId } = await seedFacility()
    const a = await createZone(orgId, { name: 'A' }, owner.userId)
    const b = await createZone(orgId, { name: 'B' }, owner.userId)
    const c = await createZone(orgId, { name: 'C' }, owner.userId)

    const reordered = await reorderZones(orgId, [c.id, a.id, b.id])
    expect(reordered.map(z => z.id)).toEqual([c.id, a.id, b.id])
    expect(reordered.map(z => z.sortOrder)).toEqual([0, 1, 2])
  })

  it('deletes a zone and ungroups its courts (never deletes them)', async () => {
    const { owner, orgId } = await seedFacility()
    const zone = await createZone(orgId, { name: 'Hall A' }, owner.userId)
    const c = await createCourt(orgId, { name: 'Court 1', sport: 'tennis', zoneId: zone.id }, owner.userId)

    expect(await deleteZone(orgId, zone.id)).toBe(true)
    // The court survives, just ungrouped.
    const stillThere = await getCourt(orgId, c.id)
    expect(stillThere?.zoneId).toBeNull()
    // Raw check: the row exists with a null zone_id.
    const [row] = await db
      .select({ id: court.id, zoneId: court.zoneId })
      .from(court)
      .where(and(eq(court.organizationId, orgId), eq(court.id, c.id)))
    expect(row).toMatchObject({ id: c.id, zoneId: null })
  })

  it('never reads, renames or deletes another tenant’s zone', async () => {
    const a = await seedFacility()
    const b = await seedFacility()
    const zoneA = await createZone(a.orgId, { name: 'Hall A' }, a.owner.userId)

    expect(await zoneBelongsToOrg(b.orgId, zoneA.id)).toBe(false)
    expect(await updateZone(b.orgId, zoneA.id, { name: 'Hijacked' })).toBeNull()
    expect(await deleteZone(b.orgId, zoneA.id)).toBe(false)
    expect(await listZones(b.orgId)).toHaveLength(0)

    // A's zone is untouched.
    const stillA = await listZones(a.orgId)
    expect(stillA).toHaveLength(1)
    expect(stillA[0]!.name).toBe('Hall A')
  })
})
