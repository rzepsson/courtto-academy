import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createMemberGuardian,
  deleteMemberGuardian,
  listMemberGuardians,
  updateMemberGuardian
} from '../../server/utils/services/memberGuardians'
import { GUARDIAN_LIMITS } from '../../shared/member-guardian'
import { addMember, createOrg, hasTestDb, resetDb, signUp } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

async function seedStudent(): Promise<{ orgId: string, memberId: string }> {
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${randomUUID().slice(0, 8)}` })
  const student = await signUp()
  const memberId = await addMember(orgId, student.userId, 'student')
  return { orgId, memberId }
}

function guardian(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Anna Kowalska',
    relationship: 'mother',
    phone: '+48 600 100 200',
    email: '',
    isPrimary: false,
    notes: '',
    ...overrides
  }
}

describe.skipIf(!hasTestDb)('member guardians service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('makes the first guardian primary automatically, whatever the payload says', async () => {
    const { orgId, memberId } = await seedStudent()

    // Explicitly NOT primary — but a lone contact nobody is told to call first
    // would defeat the point, so the service promotes it.
    const created = await createMemberGuardian(orgId, memberId, guardian({ isPrimary: false }))
    expect(created?.isPrimary).toBe(true)
    expect(created).not.toHaveProperty('organizationId')
  })

  it('keeps exactly one primary when another is promoted', async () => {
    const { orgId, memberId } = await seedStudent()
    const first = await createMemberGuardian(orgId, memberId, guardian({ name: 'Anna' }))
    const second = await createMemberGuardian(orgId, memberId, guardian({ name: 'Piotr', relationship: 'father', isPrimary: true }))

    const list = await listMemberGuardians(orgId, memberId)
    expect(list.filter(g => g.isPrimary)).toHaveLength(1)
    expect(list.find(g => g.isPrimary)?.id).toBe(second!.id)
    expect(list.find(g => g.id === first!.id)?.isPrimary).toBe(false)
    // Primary first, so the list reads in call order.
    expect(list[0]!.id).toBe(second!.id)
  })

  it('refuses to unset the primary — you promote someone else instead', async () => {
    const { orgId, memberId } = await seedStudent()
    const only = await createMemberGuardian(orgId, memberId, guardian())

    await expect(updateMemberGuardian(orgId, only!.id, { isPrimary: false }))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'GUARDIAN_PRIMARY_REQUIRED' } })
  })

  it('promotes the longest-standing survivor when the primary is removed', async () => {
    const { orgId, memberId } = await seedStudent()
    const first = await createMemberGuardian(orgId, memberId, guardian({ name: 'Anna' }))
    const second = await createMemberGuardian(orgId, memberId, guardian({ name: 'Piotr', relationship: 'father' }))
    // Promote the newer one, then delete it: the member must not be left with a
    // contact but nobody flagged to call first.
    await updateMemberGuardian(orgId, second!.id, { isPrimary: true })
    await deleteMemberGuardian(orgId, second!.id)

    const list = await listMemberGuardians(orgId, memberId)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(first!.id)
    expect(list[0]!.isPrimary).toBe(true)
  })

  it('rejects a guardian with no way to reach them, on create and on update', async () => {
    const { orgId, memberId } = await seedStudent()

    await expect(createMemberGuardian(orgId, memberId, guardian({ phone: '', email: '' })))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'INVALID_GUARDIAN' } })

    // Clearing the only channel on an existing record is caught against the MERGED
    // row — the patch alone looks innocent.
    const created = await createMemberGuardian(orgId, memberId, guardian())
    await expect(updateMemberGuardian(orgId, created!.id, { phone: '' }))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'GUARDIAN_UNREACHABLE' } })

    // ...but clearing the phone is fine once an email is on file.
    await updateMemberGuardian(orgId, created!.id, { email: 'anna@example.com' })
    const updated = await updateMemberGuardian(orgId, created!.id, { phone: '' })
    expect(updated?.phone).toBeNull()
    expect(updated?.email).toBe('anna@example.com')
  })

  it('caps the number of guardians per member', async () => {
    const { orgId, memberId } = await seedStudent()
    for (let i = 0; i < GUARDIAN_LIMITS.perMember; i++) {
      await createMemberGuardian(orgId, memberId, guardian({ name: `Guardian ${i}` }))
    }

    await expect(createMemberGuardian(orgId, memberId, guardian({ name: 'One too many' })))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'GUARDIAN_LIMIT_REACHED' } })
  })

  it('never reads or mutates another tenant’s guardians', async () => {
    const a = await seedStudent()
    const b = await seedStudent()
    const created = await createMemberGuardian(a.orgId, a.memberId, guardian())

    // B cannot add to A's member, nor touch A's guardian by id.
    expect(await createMemberGuardian(b.orgId, a.memberId, guardian())).toBeNull()
    expect(await updateMemberGuardian(b.orgId, created!.id, { name: 'Hijacked' })).toBeNull()
    expect(await deleteMemberGuardian(b.orgId, created!.id)).toBeNull()
    expect(await listMemberGuardians(b.orgId, a.memberId)).toEqual([])

    // A's record is untouched.
    const still = await listMemberGuardians(a.orgId, a.memberId)
    expect(still).toHaveLength(1)
    expect(still[0]!.name).toBe('Anna Kowalska')
  })
})
