import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getComplianceReport } from '../../server/utils/services/compliance'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { createMemberGuardian } from '../../server/utils/services/memberGuardians'
import { recordMemberConsent } from '../../server/utils/services/memberConsents'
import { db } from '../../server/utils/db'
import { member } from '../../server/database/schema'
import { addMember, createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

const MINOR_DOB = '2012-06-01'
const ADULT_DOB = '1990-01-01'

let seq = 0

async function memberIdOf(organizationId: string, userId: string): Promise<string> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return row!.id
}

async function seedSchool(): Promise<{ owner: SeededUser, orgId: string, ownerMemberId: string }> {
  seq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${seq}` })
  const ownerMemberId = await memberIdOf(orgId, owner.userId)
  return { owner, orgId, ownerMemberId }
}

async function addStudent(orgId: string, dateOfBirth: string | null): Promise<string> {
  const user = await signUp({ email: uniqueEmail('stu') })
  const memberId = await addMember(orgId, user.userId, 'student')
  if (dateOfBirth) {
    await upsertMemberProfile(orgId, memberId, { dateOfBirth })
  }
  return memberId
}

describe.skipIf(!hasTestDb)('compliance service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('classifies both gaps, counts the summary, and orders the queue', async () => {
    const { orgId, ownerMemberId } = await seedSchool()

    // A — minor, no guardian, never asked for consent → BOTH gaps.
    const a = await addStudent(orgId, MINOR_DOB)
    // B — adult with image consent granted → no gap.
    const b = await addStudent(orgId, ADULT_DOB)
    await recordMemberConsent(orgId, b, 'image', { status: 'granted', documentVersion: 'v1', notes: '' }, ownerMemberId)
    // C — adult, never asked → consent gap only.
    const c = await addStudent(orgId, ADULT_DOB)
    // D — minor WITH a guardian and guardian-given consent → no gap.
    const d = await addStudent(orgId, MINOR_DOB)
    const guardian = await createMemberGuardian(orgId, d, { name: 'Parent', relationship: 'mother', phone: '+48500600700', email: '', isPrimary: true, notes: '' })
    await recordMemberConsent(orgId, d, 'image', { status: 'granted', guardianId: guardian!.id, documentVersion: 'v1', notes: '' }, ownerMemberId)
    // E — adult whose consent was WITHDRAWN → a respected decision, NOT a gap.
    const e = await addStudent(orgId, ADULT_DOB)
    await recordMemberConsent(orgId, e, 'image', { status: 'withdrawn', documentVersion: '', notes: '' }, ownerMemberId)

    const report = await getComplianceReport(orgId)

    expect(report.summary).toEqual({
      studentsConsidered: 5,
      missingGuardian: 1,
      missingImageConsent: 2,
      withGaps: 2
    })

    const ids = report.rows.map(row => row.memberId)
    expect(ids).toContain(a)
    expect(ids).toContain(c)
    expect(ids).not.toContain(b)
    expect(ids).not.toContain(d)
    expect(ids).not.toContain(e) // withdrawn is respected, never surfaced as a gap

    // Most urgent first: the minor with nobody to call leads the queue.
    expect(report.rows[0]!.memberId).toBe(a)
    expect(report.rows[0]!.missingGuardian).toBe(true)
    expect(report.rows[0]!.missingImageConsent).toBe(true)
    expect(report.rows[0]!.isMinor).toBe(true)

    const rowC = report.rows.find(row => row.memberId === c)!
    expect(rowC.missingGuardian).toBe(false)
    expect(rowC.missingImageConsent).toBe(true)
    expect(rowC.isMinor).toBe(false)
  })

  it('a fully compliant roster reports no gaps', async () => {
    const { orgId, ownerMemberId } = await seedSchool()
    const adult = await addStudent(orgId, ADULT_DOB)
    await recordMemberConsent(orgId, adult, 'image', { status: 'granted', documentVersion: 'v1', notes: '' }, ownerMemberId)

    const report = await getComplianceReport(orgId)
    expect(report.summary.studentsConsidered).toBe(1)
    expect(report.summary.withGaps).toBe(0)
    expect(report.rows).toEqual([])
  })

  it('is tenant-scoped — another school\'s gaps never leak in', async () => {
    const school = await seedSchool()
    const other = await seedSchool()

    // The OTHER school has a minor with no guardian and no consent — a clear gap,
    // but in a different tenant.
    await addStudent(other.orgId, MINOR_DOB)

    // THIS school's one student is fully compliant: a guardian on file + that
    // guardian's image consent. If tenant scoping were wrong, the other school's
    // gappy minor would inflate these numbers.
    const mine = await addStudent(school.orgId, MINOR_DOB)
    const guardian = await createMemberGuardian(school.orgId, mine, { name: 'Parent', relationship: 'father', phone: '', email: 'p@ex.com', isPrimary: true, notes: '' })
    await recordMemberConsent(school.orgId, mine, 'image', { status: 'granted', guardianId: guardian!.id, documentVersion: 'v1', notes: '' }, school.ownerMemberId)

    const report = await getComplianceReport(school.orgId)
    expect(report.summary.studentsConsidered).toBe(1)
    expect(report.summary.missingGuardian).toBe(0)
    expect(report.summary.missingImageConsent).toBe(0)
    expect(report.rows).toEqual([])
  })
})
