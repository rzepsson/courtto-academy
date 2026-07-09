import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  archiveCourt,
  createCourt,
  deleteCourt,
  getCourt,
  listCourts,
  reorderCourts,
  restoreCourt,
  updateCourt
} from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

// The courts service reaches for `createError` as a Nuxt server auto-import.
// Provide it so we exercise the real validation/isolation logic against the
// test database (mirrors require-active-membership.test.ts).
const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

// Seed a facility that offers tennis + padel, so court creation has valid sports.
async function seedFacility(sports: string[] = ['tennis', 'padel']): Promise<{ owner: SeededUser, orgId: string }> {
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}` })
  await upsertOrgProfile(orgId, { sports })
  return { owner, orgId }
}

describe.skipIf(!hasTestDb)('courts service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates a court with sport-derived defaults and no leaked columns', async () => {
    const { owner, orgId } = await seedFacility()

    const created = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)

    expect(created.name).toBe('Court 1')
    expect(created.sport).toBe('tennis')
    expect(created.environment).toBe('indoor')
    expect(created.status).toBe('active')
    expect(created.surfaceColor).toMatch(/^#[0-9a-f]{6}$/i) // seeded from DEFAULT_SURFACE_COLOR
    expect(created.lineColor).toBe('#ffffff')
    expect(created.sortOrder).toBe(0)
    expect(created.archivedAt).toBeNull()
    // DTO must not expose org id or audit columns.
    expect(created).not.toHaveProperty('organizationId')
    expect(created).not.toHaveProperty('createdBy')
  })

  it('rejects a sport the facility does not offer', async () => {
    const { owner, orgId } = await seedFacility(['tennis'])

    await expect(createCourt(orgId, { name: 'Box 1', sport: 'padel' }, owner.userId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'COURT_SPORT_NOT_OFFERED' } })
  })

  it('rejects a surface invalid for the sport', async () => {
    const { owner, orgId } = await seedFacility()

    await expect(createCourt(orgId, { name: 'Court 1', sport: 'tennis', surface: 'sand' }, owner.userId))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('assigns an incrementing sortOrder and rejects a duplicate name (case-insensitive)', async () => {
    const { owner, orgId } = await seedFacility()

    const a = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
    const b = await createCourt(orgId, { name: 'Court 2', sport: 'padel' }, owner.userId)
    expect(a.sortOrder).toBe(0)
    expect(b.sortOrder).toBe(1)

    await expect(createCourt(orgId, { name: 'court 1', sport: 'tennis' }, owner.userId))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'COURT_NAME_TAKEN' } })
  })

  it('lists only active courts by default, and includes archived on request', async () => {
    const { owner, orgId } = await seedFacility()
    const a = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
    await createCourt(orgId, { name: 'Court 2', sport: 'padel' }, owner.userId)

    await archiveCourt(orgId, a.id)

    const active = await listCourts(orgId)
    expect(active.map(c => c.name)).toEqual(['Court 2'])

    const all = await listCourts(orgId, { includeArchived: true })
    expect(all.map(c => c.name).sort()).toEqual(['Court 1', 'Court 2'])
  })

  it('updates fields and, on a sport change, drops a now-invalid surface', async () => {
    const { owner, orgId } = await seedFacility()
    const created = await createCourt(
      orgId,
      { name: 'Court 1', sport: 'tennis', surface: 'clay' },
      owner.userId
    )
    expect(created.surface).toBe('clay')

    const updated = await updateCourt(orgId, created.id, { sport: 'padel', status: 'maintenance' })
    expect(updated?.sport).toBe('padel')
    expect(updated?.status).toBe('maintenance')
    // 'clay' isn't a padel surface, so it must be cleared rather than persisted invalid.
    expect(updated?.surface).toBeNull()
  })

  it('archives (freeing the name), then restores', async () => {
    const { owner, orgId } = await seedFacility()
    const created = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)

    const archived = await archiveCourt(orgId, created.id)
    expect(archived?.archivedAt).not.toBeNull()

    // The name is free again while it's archived.
    const reused = await createCourt(orgId, { name: 'Court 1', sport: 'padel' }, owner.userId)
    expect(reused.name).toBe('Court 1')

    // Restoring the original now collides with the reused name.
    await expect(restoreCourt(orgId, created.id))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'COURT_NAME_TAKEN' } })
  })

  it('permanently deletes a court, removing it from every view and freeing the name', async () => {
    const { owner, orgId } = await seedFacility()
    const created = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)

    const deleted = await deleteCourt(orgId, created.id)
    expect(deleted?.id).toBe(created.id)

    // Gone from both the active and the archived-inclusive views, and by id.
    expect(await listCourts(orgId, { includeArchived: true })).toEqual([])
    expect(await getCourt(orgId, created.id)).toBeNull()

    // The name is free to reuse.
    const reused = await createCourt(orgId, { name: 'Court 1', sport: 'padel' }, owner.userId)
    expect(reused.name).toBe('Court 1')
  })

  it('reorders courts by index', async () => {
    const { owner, orgId } = await seedFacility()
    const a = await createCourt(orgId, { name: 'Court A', sport: 'tennis' }, owner.userId)
    const b = await createCourt(orgId, { name: 'Court B', sport: 'padel' }, owner.userId)
    const c = await createCourt(orgId, { name: 'Court C', sport: 'tennis' }, owner.userId)

    const reordered = await reorderCourts(orgId, [c.id, a.id, b.id])
    expect(reordered.map(court => court.name)).toEqual(['Court C', 'Court A', 'Court B'])
    expect(reordered.map(court => court.sortOrder)).toEqual([0, 1, 2])
  })

  it('never reads or mutates another tenant’s courts', async () => {
    const facilityA = await seedFacility()
    const facilityB = await seedFacility()

    const courtA = await createCourt(facilityA.orgId, { name: 'Court 1', sport: 'tennis' }, facilityA.owner.userId)
    await createCourt(facilityB.orgId, { name: 'Court 1', sport: 'tennis' }, facilityB.owner.userId)

    // B's roster never includes A's court.
    const listB = await listCourts(facilityB.orgId)
    expect(listB.find(c => c.id === courtA.id)).toBeUndefined()

    // B cannot fetch, update, archive or delete A's court by id.
    expect(await getCourt(facilityB.orgId, courtA.id)).toBeNull()
    expect(await updateCourt(facilityB.orgId, courtA.id, { name: 'Hijacked' })).toBeNull()
    expect(await archiveCourt(facilityB.orgId, courtA.id)).toBeNull()
    expect(await deleteCourt(facilityB.orgId, courtA.id)).toBeNull()

    // A's court is untouched.
    const stillA = await getCourt(facilityA.orgId, courtA.id)
    expect(stillA?.name).toBe('Court 1')
    expect(stillA?.archivedAt).toBeNull()
  })

  it('reorder ignores ids from another tenant', async () => {
    const facilityA = await seedFacility()
    const facilityB = await seedFacility()
    const courtA = await createCourt(facilityA.orgId, { name: 'Court 1', sport: 'tennis' }, facilityA.owner.userId)
    const courtB = await createCourt(facilityB.orgId, { name: 'Court 1', sport: 'tennis' }, facilityB.owner.userId)

    // Try to sweep A's court into B's reorder — it must be a no-op for A.
    await reorderCourts(facilityB.orgId, [courtA.id, courtB.id])

    const stillA = await getCourt(facilityA.orgId, courtA.id)
    expect(stillA?.sortOrder).toBe(0) // unchanged
  })
})
