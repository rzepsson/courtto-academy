import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import {
  getLatestAcceptance,
  getUserLegalState,
  listAccountConsents,
  mayContactForMarketing,
  recordLegalAcceptance,
  setAccountConsent
} from '../../server/utils/services/legal'
import { db } from '../../server/utils/db'
import { userAgreement, userConsent } from '../../server/database/app-schema'
import { LEGAL_DOCUMENT_VERSIONS } from '../../shared/legal'
import { hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

describe.skipIf(!hasTestDb)('legal service', () => {
  let person: SeededUser

  beforeEach(async () => {
    await resetDb()
    person = await signUp()
  })

  // THE test for this feature. Everything else is bookkeeping around it: if the
  // Better Auth user-create hook is not wired, acceptance is never recorded and
  // there is no evidence anyone ever agreed to anything — and no static gate
  // would catch it, because the hook only runs against a real database.
  it('records acceptance automatically when an account is created', async () => {
    const acceptance = await getLatestAcceptance(person.userId)

    expect(acceptance).not.toBeNull()
    expect(acceptance!.termsVersion).toBe(LEGAL_DOCUMENT_VERSIONS.terms)
    expect(acceptance!.privacyVersion).toBe(LEGAL_DOCUMENT_VERSIONS.privacy)
    expect(acceptance!.acceptedAt).toBeInstanceOf(Date)
  })

  it('reports a freshly created account as not needing re-acceptance', async () => {
    const state = await getUserLegalState(person.userId)

    expect(state.needsReacceptance).toBe(false)
    expect(state.currentVersions).toEqual(LEGAL_DOCUMENT_VERSIONS)
  })

  // Append-only: a re-acceptance after a version bump must not overwrite the
  // earlier one. The old row is the proof of what was agreed to back then.
  it('keeps every acceptance and reads back the most recent', async () => {
    await recordLegalAcceptance({ userId: person.userId, ipAddress: '203.0.113.7', userAgent: 'Test/1.0' })

    const rows = await db
      .select()
      .from(userAgreement)
      .where(eq(userAgreement.userId, person.userId))
      .orderBy(desc(userAgreement.acceptedAt))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.ipAddress).toBe('203.0.113.7')
    expect(rows[0]!.userAgent).toBe('Test/1.0')

    const acceptance = await getLatestAcceptance(person.userId)
    expect(acceptance!.acceptedAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.acceptedAt.getTime())
  })

  it('scopes acceptance to its own user', async () => {
    const other = await signUp()

    const rows = await db.select().from(userAgreement).where(eq(userAgreement.userId, person.userId))
    expect(rows).toHaveLength(1)

    const otherRows = await db.select().from(userAgreement).where(eq(userAgreement.userId, other.userId))
    expect(otherRows).toHaveLength(1)
    expect(otherRows[0]!.userId).not.toBe(person.userId)
  })

  describe('account consent', () => {
    it('starts as never asked, which is not permission', async () => {
      const consents = await listAccountConsents(person.userId)
      const marketing = consents.find(entry => entry.type === 'marketing')

      expect(marketing).toBeDefined()
      expect(marketing!.asked).toBe(false)
      expect(marketing!.granted).toBe(false)
      expect(await mayContactForMarketing(person.userId)).toBe(false)
    })

    it('grants and reflects the decision', async () => {
      await setAccountConsent({
        userId: person.userId,
        type: 'marketing',
        decision: 'granted',
        documentVersion: LEGAL_DOCUMENT_VERSIONS.privacy
      })

      const [row] = await db.select().from(userConsent).where(eq(userConsent.userId, person.userId))
      expect(row!.status).toBe('granted')
      expect(row!.grantedAt).toBeInstanceOf(Date)
      expect(row!.withdrawnAt).toBeNull()
      expect(row!.documentVersion).toBe(LEGAL_DOCUMENT_VERSIONS.privacy)

      expect(await mayContactForMarketing(person.userId)).toBe(true)
    })

    // The doctrine that matters: withdrawal must not destroy the evidence that
    // the earlier sends were lawful. Erasing grantedAt would leave no way to show
    // that messages sent last year had consent behind them.
    it('keeps grantedAt when consent is withdrawn', async () => {
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'granted' })
      const [before] = await db.select().from(userConsent).where(eq(userConsent.userId, person.userId))

      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'withdrawn' })
      const [after] = await db.select().from(userConsent).where(eq(userConsent.userId, person.userId))

      expect(after!.status).toBe('withdrawn')
      expect(after!.withdrawnAt).toBeInstanceOf(Date)
      expect(after!.grantedAt).not.toBeNull()
      expect(after!.grantedAt!.getTime()).toBe(before!.grantedAt!.getTime())

      expect(await mayContactForMarketing(person.userId)).toBe(false)
    })

    it('distinguishes withdrawn from never asked', async () => {
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'granted' })
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'withdrawn' })

      const consents = await listAccountConsents(person.userId)
      const marketing = consents.find(entry => entry.type === 'marketing')!

      // Both block sending, but only one of them is a decision to respect.
      expect(marketing.granted).toBe(false)
      expect(marketing.asked).toBe(true)
    })

    it('starts a fresh lawful period when consent is given again', async () => {
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'granted' })
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'withdrawn' })
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'granted' })

      const rows = await db.select().from(userConsent).where(eq(userConsent.userId, person.userId))

      // Upsert, not insert — one current decision per (user, purpose).
      expect(rows).toHaveLength(1)
      expect(rows[0]!.status).toBe('granted')
      expect(rows[0]!.withdrawnAt).toBeNull()
      expect(await mayContactForMarketing(person.userId)).toBe(true)
    })

    it('keeps one user consent from affecting another', async () => {
      const other = await signUp()
      await setAccountConsent({ userId: person.userId, type: 'marketing', decision: 'granted' })

      expect(await mayContactForMarketing(person.userId)).toBe(true)
      expect(await mayContactForMarketing(other.userId)).toBe(false)
    })
  })
})
