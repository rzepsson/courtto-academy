import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listMemberConsents, recordMemberConsent } from '../../server/utils/services/memberConsents'
import { createMemberGuardian } from '../../server/utils/services/memberGuardians'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { addMember, createOrg, hasTestDb, resetDb, signUp } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

interface Seed {
  orgId: string
  memberId: string
  staffMemberId: string
}

// A student born in 2015 is unambiguously a minor for the lifetime of this code.
async function seedStudent(dateOfBirth: string | null = '2015-04-01'): Promise<Seed> {
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${randomUUID().slice(0, 8)}` })
  const { rows } = await import('../../server/utils/services/memberProfile')
    .then(m => m.listMembersDirectory(orgId))
  const staffMemberId = rows[0]!.id

  const student = await signUp({ name: 'Zosia' })
  const memberId = await addMember(orgId, student.userId, 'student')
  if (dateOfBirth) {
    await upsertMemberProfile(orgId, memberId, { dateOfBirth })
  }
  return { orgId, memberId, staffMemberId }
}

function guardianBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Anna Kowalska',
    relationship: 'mother',
    phone: '+48 600 100 200',
    email: '',
    isPrimary: true,
    notes: '',
    ...overrides
  }
}

const decision = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  documentVersion: '',
  notes: '',
  ...extra
})

describe.skipIf(!hasTestDb)('member consents service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('lists every known purpose, with never-asked ones as “unknown”', async () => {
    const { orgId, memberId } = await seedStudent()

    const consents = await listMemberConsents(orgId, memberId)
    expect(consents?.map(c => c.type).sort()).toEqual(['image', 'marketing'])
    // The gap is surfaced, not omitted — it's the actionable state.
    expect(consents?.every(c => c.state === 'unknown')).toBe(true)
    // A minor, so the decision has to come from a guardian.
    expect(consents?.every(c => c.requiresGuardian)).toBe(true)
  })

  it('refuses a minor’s consent without a guardian, and accepts it from theirs', async () => {
    const seed = await seedStudent()

    await expect(recordMemberConsent(seed.orgId, seed.memberId, 'image', decision('granted'), seed.staffMemberId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'CONSENT_GUARDIAN_REQUIRED' } })

    const guardian = await createMemberGuardian(seed.orgId, seed.memberId, guardianBody())
    const result = await recordMemberConsent(
      seed.orgId,
      seed.memberId,
      'image',
      decision('granted', { guardianId: guardian!.id }),
      seed.staffMemberId
    )

    expect(result?.consent).toMatchObject({ state: 'granted', grantedByName: 'Anna Kowalska' })
    expect(result?.consent.grantedAt).not.toBeNull()
  })

  it('rejects a guardian who belongs to someone else', async () => {
    const a = await seedStudent()
    const b = await seedStudent()
    const foreign = await createMemberGuardian(b.orgId, b.memberId, guardianBody())

    await expect(recordMemberConsent(
      a.orgId,
      a.memberId,
      'image',
      decision('granted', { guardianId: foreign!.id }),
      a.staffMemberId
    )).rejects.toMatchObject({ statusCode: 400, data: { code: 'CONSENT_GUARDIAN_INVALID' } })
  })

  it('lets an adult consent for themselves, with no guardian involved', async () => {
    // Born in 1990 → an adult, so no guardian is required.
    const seed = await seedStudent('1990-06-15')

    const result = await recordMemberConsent(seed.orgId, seed.memberId, 'marketing', decision('granted'), seed.staffMemberId)
    expect(result?.consent).toMatchObject({ state: 'granted', grantedByName: 'Zosia', guardianId: null })
  })

  it('withdraws without paperwork and KEEPS grantedAt as the evidence', async () => {
    const seed = await seedStudent('1990-06-15')
    const granted = await recordMemberConsent(seed.orgId, seed.memberId, 'image', decision('granted'), seed.staffMemberId)
    const grantedAt = granted!.consent.grantedAt

    // Art. 7(3): withdrawal is as easy as giving — no guardian, no extra fields.
    const withdrawn = await recordMemberConsent(seed.orgId, seed.memberId, 'image', decision('withdrawn'), seed.staffMemberId)

    expect(withdrawn?.consent.state).toBe('withdrawn')
    expect(withdrawn?.consent.withdrawnAt).not.toBeNull()
    // The period during which processing WAS lawful must remain provable.
    expect(withdrawn?.consent.grantedAt).toEqual(grantedAt)
  })

  it('re-granting after a withdrawal reopens the consent', async () => {
    const seed = await seedStudent('1990-06-15')
    await recordMemberConsent(seed.orgId, seed.memberId, 'image', decision('granted'), seed.staffMemberId)
    await recordMemberConsent(seed.orgId, seed.memberId, 'image', decision('withdrawn'), seed.staffMemberId)

    const again = await recordMemberConsent(seed.orgId, seed.memberId, 'image', decision('granted'), seed.staffMemberId)
    expect(again?.consent.state).toBe('granted')
    expect(again?.consent.withdrawnAt).toBeNull()
  })

  it('rejects an unknown purpose and never reads another tenant', async () => {
    const a = await seedStudent()
    const b = await seedStudent()

    await expect(recordMemberConsent(a.orgId, a.memberId, 'data_processing', decision('granted'), a.staffMemberId))
      .rejects.toMatchObject({ statusCode: 400, data: { code: 'CONSENT_TYPE_UNKNOWN' } })

    expect(await listMemberConsents(b.orgId, a.memberId)).toBeNull()
    expect(await recordMemberConsent(b.orgId, a.memberId, 'image', decision('withdrawn'), b.staffMemberId)).toBeNull()
  })
})
