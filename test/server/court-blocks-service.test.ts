import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createCourtBlock, deleteCourtBlock, listCourtBlocks } from '../../server/utils/services/courtBlocks'
import { createLesson } from '../../server/utils/services/schedule'
import { archiveCourt, createCourt } from '../../server/utils/services/courts'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { db } from '../../server/utils/db'
import { reservation } from '../../server/database/app-schema'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'
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
}

async function seedSchool(): Promise<School> {
  orgSeq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${orgSeq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis'], timezone: 'Europe/Warsaw' })
  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
  return { owner, orgId, courtId: court.id }
}

// A one-off tennis lesson at 2026-09-07 17:00–18:00 local (the fixture the block
// conflict tests overlap). Legacy flat body the service normalizes to one rule.
function lessonBody(school: School, overrides: Record<string, unknown> = {}) {
  return {
    type: 'group',
    sport: 'tennis',
    title: 'Grupa A',
    dtStart: '2026-09-07T17:00',
    durationMin: 60,
    defaultCourtId: school.courtId,
    ...overrides
  }
}

const WIDE = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') }

describe.skipIf(!hasTestDb)('court blocks service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates a whole-day maintenance block and lists it', async () => {
    const school = await seedSchool()
    const block = await createCourtBlock(
      school.orgId,
      school.courtId,
      { kind: 'maintenance', startLocal: '2026-09-10T00:00', endLocal: '2026-09-12T00:00', title: 'Resurfacing' },
      school.owner.userId
    )

    expect(block.kind).toBe('maintenance')
    expect(block.title).toBe('Resurfacing')
    expect(block.status).toBe('confirmed')
    expect(block.courtId).toBe(school.courtId)
    // DTO must not leak org id / audit columns.
    expect(block).not.toHaveProperty('organizationId')
    expect(block).not.toHaveProperty('createdBy')

    const listed = await listCourtBlocks(school.orgId, WIDE)
    expect(listed.map(b => b.id)).toEqual([block.id])
  })

  it('defaults an omitted kind to maintenance', async () => {
    const school = await seedSchool()
    const block = await createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-10T09:00', endLocal: '2026-09-10T11:00' },
      school.owner.userId
    )
    expect(block.kind).toBe('maintenance')
  })

  it('rejects a reversed range at parse time', async () => {
    const school = await seedSchool()
    await expect(createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-10T12:00', endLocal: '2026-09-10T10:00' },
      school.owner.userId
    )).rejects.toMatchObject({ statusCode: 400, data: { code: 'COURT_BLOCK_INVALID' } })
  })

  it('refuses a court from another facility (tenant isolation)', async () => {
    const a = await seedSchool()
    const b = await seedSchool()
    // b's owner cannot block a's court via b's org scope.
    await expect(createCourtBlock(
      b.orgId,
      a.courtId,
      { startLocal: '2026-09-10T09:00', endLocal: '2026-09-10T11:00' },
      b.owner.userId
    )).rejects.toMatchObject({ statusCode: 400, data: { code: 'COURT_BLOCK_COURT_NOT_FOUND' } })
  })

  it('refuses an archived court', async () => {
    const school = await seedSchool()
    await archiveCourt(school.orgId, school.courtId)
    await expect(createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-10T09:00', endLocal: '2026-09-10T11:00' },
      school.owner.userId
    )).rejects.toMatchObject({ data: { code: 'COURT_BLOCK_COURT_NOT_FOUND' } })
  })

  it('rejects a block overlapping an existing lesson', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    // 16:00–17:30 local overlaps the 17:00–18:00 lesson.
    await expect(createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-07T16:00', endLocal: '2026-09-07T17:30' },
      school.owner.userId
    )).rejects.toMatchObject({ statusCode: 409, data: { code: 'COURT_BLOCK_CONFLICT' } })
  })

  it('allows a block back-to-back with a lesson (half-open, no overlap)', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    // 18:00–19:00 starts exactly when the lesson ends.
    const block = await createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-07T18:00', endLocal: '2026-09-07T19:00' },
      school.owner.userId
    )
    expect(block.id).toBeTruthy()
  })

  it('prevents a lesson being scheduled over an existing block', async () => {
    const school = await seedSchool()
    await createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-07T16:00', endLocal: '2026-09-07T20:00' },
      school.owner.userId
    )
    await expect(createLesson(school.orgId, lessonBody(school), school.owner.userId))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'SCHEDULE_COURT_CONFLICT' } })
  })

  it('filters the list to a single court when courtId is given', async () => {
    const school = await seedSchool()
    const courtB = await createCourt(school.orgId, { name: 'Court 2', sport: 'tennis' }, school.owner.userId)
    await createCourtBlock(school.orgId, school.courtId, { startLocal: '2026-09-10T09:00', endLocal: '2026-09-10T11:00' }, school.owner.userId)
    await createCourtBlock(school.orgId, courtB.id, { startLocal: '2026-09-10T09:00', endLocal: '2026-09-10T11:00' }, school.owner.userId)

    expect(await listCourtBlocks(school.orgId, WIDE)).toHaveLength(2)
    const onlyB = await listCourtBlocks(school.orgId, { ...WIDE, courtId: courtB.id })
    expect(onlyB).toHaveLength(1)
    expect(onlyB[0]!.courtId).toBe(courtB.id)
  })

  it('lists only blocks, never lesson reservations', async () => {
    const school = await seedSchool()
    await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    await createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-08T09:00', endLocal: '2026-09-08T11:00' },
      school.owner.userId
    )
    const listed = await listCourtBlocks(school.orgId, WIDE)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.kind).toBe('maintenance')
  })

  it('deletes a block and reports gone for a wrong id / tenant', async () => {
    const school = await seedSchool()
    const other = await seedSchool()
    const block = await createCourtBlock(
      school.orgId,
      school.courtId,
      { startLocal: '2026-09-10T09:00', endLocal: '2026-09-10T11:00' },
      school.owner.userId
    )
    // Another tenant can't delete it.
    expect(await deleteCourtBlock(other.orgId, block.id)).toBe(false)
    // The owner can.
    expect(await deleteCourtBlock(school.orgId, block.id)).toBe(true)
    // Now gone.
    expect(await deleteCourtBlock(school.orgId, block.id)).toBe(false)
    expect(await listCourtBlocks(school.orgId, WIDE)).toHaveLength(0)
  })

  it('never deletes a lesson reservation via the block path', async () => {
    const school = await seedSchool()
    const lesson = await createLesson(school.orgId, lessonBody(school), school.owner.userId)
    const reservationId = lesson.sessions[0]!.reservationId

    expect(await deleteCourtBlock(school.orgId, reservationId)).toBe(false)
    // The lesson's reservation is untouched.
    const [row] = await db
      .select({ id: reservation.id, kind: reservation.kind })
      .from(reservation)
      .where(and(eq(reservation.organizationId, school.orgId), eq(reservation.id, reservationId)))
    expect(row).toMatchObject({ id: reservationId, kind: 'lesson' })
  })
})
