import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  getMemberDetail,
  getMemberProfile,
  listMembersDirectory,
  listMembersForExport,
  normalizeMemberProfilePatch,
  upsertMemberProfile
} from '../../server/utils/services/memberProfile'
import { addMember, createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'
import type { SeededUser } from './helpers'
import type { OrgRole } from '../../shared/permissions'

// The service reaches for `createError` as a Nuxt server auto-import (in the patch
// validator). Provide it so we exercise the real logic against the test DB.
const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

interface SeededOrg {
  owner: SeededUser
  orgId: string
  ownerMemberId: string
}

async function seedOrg(): Promise<SeededOrg> {
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `org-${randomUUID().slice(0, 8)}` })
  // The owner's membership (the only one so far) — resolve its id from the directory.
  const { rows } = await listMembersDirectory(orgId)
  return { owner, orgId, ownerMemberId: rows[0]!.id }
}

// Sign up a fresh user and add them to the org, returning the new membership id.
async function addUser(orgId: string, role: OrgRole, name?: string): Promise<{ user: SeededUser, memberId: string }> {
  const user = await signUp({ name, email: uniqueEmail() })
  const memberId = await addMember(orgId, user.userId, role)
  return { user, memberId }
}

describe.skipIf(!hasTestDb)('member profile service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('returns defaults for a member with no sidecar row', async () => {
    const { orgId, ownerMemberId } = await seedOrg()

    const profile = await getMemberProfile(orgId, ownerMemberId)
    expect(profile).toEqual({ status: 'active', canCoach: false, dateOfBirth: null, notes: null, tags: [] })
  })

  it('upserts fields and a partial patch never clobbers the others', async () => {
    const { orgId } = await seedOrg()
    const student = await addUser(orgId, 'student')

    const updated = await upsertMemberProfile(orgId, student.memberId, {
      status: 'suspended',
      canCoach: true,
      dateOfBirth: '2012-04-05',
      tags: ['VIP', 'vip'] // deduped by the schema before it reaches here in real flow
    })
    expect(updated).toEqual({
      status: 'suspended',
      canCoach: true,
      dateOfBirth: '2012-04-05',
      notes: null,
      tags: ['VIP', 'vip']
    })

    // A later patch touching only `notes` leaves every other field intact.
    const again = await upsertMemberProfile(orgId, student.memberId, { notes: 'call guardian' })
    expect(again).toEqual({
      status: 'suspended',
      canCoach: true,
      dateOfBirth: '2012-04-05',
      notes: 'call guardian',
      tags: ['VIP', 'vip']
    })
  })

  it('rejects an invalid patch body with a stable code', () => {
    let thrown: unknown
    try {
      normalizeMemberProfilePatch({ status: 'nope' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ statusCode: 400, data: { code: 'INVALID_MEMBER_PROFILE' } })
  })

  it('never reads or mutates another tenant’s member profile', async () => {
    const a = await seedOrg()
    const b = await seedOrg()

    // B cannot read A's owner profile by member id.
    expect(await getMemberProfile(b.orgId, a.ownerMemberId)).toBeNull()

    // B's write against A's member is a no-op returning null...
    expect(await upsertMemberProfile(b.orgId, a.ownerMemberId, { status: 'archived' })).toBeNull()

    // ...and A's member is untouched.
    expect((await getMemberProfile(a.orgId, a.ownerMemberId))!.status).toBe('active')
  })

  it('paginates the directory and defaults rows without a sidecar to active', async () => {
    const { orgId } = await seedOrg() // owner is member #1 (name 'Test User')
    for (const name of ['Anna', 'Bartek', 'Cezary', 'Diana']) {
      await addUser(orgId, 'student', name)
    }

    const page1 = await listMembersDirectory(orgId, { pageSize: 2, page: 1, sort: 'name', order: 'asc' })
    expect(page1.total).toBe(5)
    expect(page1.pageSize).toBe(2)
    expect(page1.rows).toHaveLength(2)
    expect(page1.rows.map(r => r.user.name)).toEqual(['Anna', 'Bartek'])
    // No sidecar rows yet → everyone is active, non-coach.
    expect(page1.rows.every(r => r.status === 'active' && r.canCoach === false)).toBe(true)
    // The row must not leak the org id or audit columns.
    expect(page1.rows[0]).not.toHaveProperty('organizationId')

    const lastPage = await listMembersDirectory(orgId, { pageSize: 2, page: 3, sort: 'name', order: 'asc' })
    expect(lastPage.rows.map(r => r.user.name)).toEqual(['Test User'])
  })

  it('searches by name or email (case-insensitive)', async () => {
    const { orgId } = await seedOrg()
    const user = await signUp({ name: 'Searchable Person', email: uniqueEmail('findme') })
    await addMember(orgId, user.userId, 'coach')

    const byName = await listMembersDirectory(orgId, { search: 'SEARCHABLE' })
    expect(byName.total).toBe(1)
    expect(byName.rows[0]!.user.name).toBe('Searchable Person')

    const byEmail = await listMembersDirectory(orgId, { search: 'findme' })
    expect(byEmail.total).toBe(1)
    expect(byEmail.rows[0]!.user.id).toBe(user.userId)
  })

  it('filters by role', async () => {
    const { orgId } = await seedOrg()
    await addUser(orgId, 'student')
    await addUser(orgId, 'coach')

    const students = await listMembersDirectory(orgId, { roles: ['student'] })
    expect(students.total).toBe(1)
    expect(students.rows.every(r => r.role === 'student')).toBe(true)

    const staff = await listMembersDirectory(orgId, { roles: ['owner', 'coach'] })
    expect(staff.total).toBe(2)
  })

  it('filters by sidecar status and the canCoach capability', async () => {
    const { orgId, ownerMemberId } = await seedOrg()
    const student = await addUser(orgId, 'student')
    await upsertMemberProfile(orgId, student.memberId, { status: 'archived' })
    await upsertMemberProfile(orgId, ownerMemberId, { canCoach: true }) // owner who also teaches

    const active = await listMembersDirectory(orgId, { statuses: ['active'] })
    expect(active.rows.map(r => r.id)).toContain(ownerMemberId)
    expect(active.rows.map(r => r.id)).not.toContain(student.memberId)

    const archived = await listMembersDirectory(orgId, { statuses: ['archived'] })
    expect(archived.total).toBe(1)
    expect(archived.rows[0]!.id).toBe(student.memberId)

    const coaches = await listMembersDirectory(orgId, { canCoach: true })
    expect(coaches.total).toBe(1)
    expect(coaches.rows[0]!.id).toBe(ownerMemberId)
  })

  it('never lists another tenant’s members', async () => {
    const a = await seedOrg()
    const b = await seedOrg()
    const aStudent = await addUser(a.orgId, 'student')

    const listB = await listMembersDirectory(b.orgId)
    expect(listB.total).toBe(1) // only B's owner
    expect(listB.rows.find(r => r.id === aStudent.memberId)).toBeUndefined()
  })

  it('reads a full member detail record, scoped to the org', async () => {
    const { orgId } = await seedOrg()
    const student = await addUser(orgId, 'student', 'Nina')
    await upsertMemberProfile(orgId, student.memberId, { notes: 'left-handed', tags: ['junior'] })

    const detail = await getMemberDetail(orgId, student.memberId)
    expect(detail).toMatchObject({
      id: student.memberId,
      role: 'student',
      status: 'active',
      canCoach: false,
      notes: 'left-handed',
      tags: ['junior'],
      user: { name: 'Nina' }
    })
    expect(detail).not.toHaveProperty('organizationId')

    // Another tenant can't read it.
    const other = await seedOrg()
    expect(await getMemberDetail(other.orgId, student.memberId)).toBeNull()
  })

  it('protects the owner from suspend/archive but allows active + capability changes', async () => {
    const { orgId, ownerMemberId } = await seedOrg()

    await expect(upsertMemberProfile(orgId, ownerMemberId, { status: 'suspended' }))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'MEMBER_OWNER_STATUS' } })
    await expect(upsertMemberProfile(orgId, ownerMemberId, { status: 'archived' }))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'MEMBER_OWNER_STATUS' } })

    // Setting the owner active (a no-op transition) and toggling canCoach are fine.
    expect(await upsertMemberProfile(orgId, ownerMemberId, { status: 'active' }))
      .toMatchObject({ status: 'active' })
    expect(await upsertMemberProfile(orgId, ownerMemberId, { canCoach: true }))
      .toMatchObject({ canCoach: true, status: 'active' })
  })

  it('exports all matching rows unpaginated, honoring filters and tenant scope', async () => {
    const { orgId } = await seedOrg()
    for (const name of ['Anna', 'Bartek', 'Cezary']) {
      await addUser(orgId, 'student', name)
    }
    await addUser(orgId, 'coach', 'Coach Carl')
    const other = await seedOrg()
    await addUser(other.orgId, 'student', 'Foreign')

    // No filter → every member of this org (owner + 3 students + coach), no page cap.
    const all = await listMembersForExport(orgId)
    expect(all).toHaveLength(5)

    // Role filter is respected.
    const students = await listMembersForExport(orgId, { roles: ['student'] })
    expect(students).toHaveLength(3)
    expect(students.every(r => r.role === 'student')).toBe(true)

    // Never bleeds another tenant's members in.
    expect(all.some(r => r.user.name === 'Foreign')).toBe(false)
  })
})
