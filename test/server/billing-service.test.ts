import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../server/utils/db'
import { subscription } from '../../server/database/schema'
import { getOrgBilling, getOrgEntitlement } from '../../server/utils/services/billing'
import { createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'

const DAY = 24 * 60 * 60 * 1000

// Test-only direct write to the Better Auth-owned `subscription` table (mirrors
// helpers' expireInvitation): product code only ever writes it through the Stripe
// plugin (checkout/portal/webhooks), and there's no API to fabricate a given
// subscription state without a live Stripe.
async function seedSubscription(
  organizationId: string,
  over: Partial<{ plan: string, status: string, periodEnd: Date | null, trialEnd: Date | null, cancelAtPeriodEnd: boolean }> = {}
): Promise<void> {
  await db.insert(subscription).values({
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    plan: over.plan ?? 'pro',
    referenceId: organizationId,
    status: over.status ?? 'active',
    periodEnd: over.periodEnd === undefined ? new Date(Date.now() + 20 * DAY) : over.periodEnd,
    trialEnd: over.trialEnd ?? null,
    cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false
  })
}

// Backdate an org past its trial window so entitlement depends on a subscription.
async function ageOrg(organizationId: string, days: number): Promise<void> {
  await db.execute(
    sql`UPDATE "organization" SET "created_at" = now() - (${days} * interval '1 day') WHERE "id" = ${organizationId}`
  )
}

describe.skipIf(!hasTestDb)('billing service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('a fresh school is entitled on its app-managed trial', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })

    const entitlement = await getOrgEntitlement(orgId)
    expect(entitlement.entitled).toBe(true)
    expect(entitlement.status).toBe('trialing')
    expect(entitlement.planId).toBeNull()
    expect(entitlement.trialDaysLeft).toBeGreaterThan(0)
  })

  it('blocks once the trial window has elapsed with no subscription', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await ageOrg(orgId, 30)

    const entitlement = await getOrgEntitlement(orgId)
    expect(entitlement.entitled).toBe(false)
    expect(entitlement.status).toBe('none')
  })

  it('an active subscription entitles a school past its trial', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await ageOrg(orgId, 30)
    await seedSubscription(orgId, { status: 'active', plan: 'pro' })

    const { entitlement, subscription: summary } = await getOrgBilling(orgId)
    expect(entitlement.entitled).toBe(true)
    expect(entitlement.status).toBe('active')
    expect(entitlement.planId).toBe('pro')
    expect(summary?.plan).toBe('pro')
  })

  it('a canceled subscription blocks (never falls back to the trial)', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    // Still inside the calendar trial window, but having a (canceled) subscription
    // means they were a customer — no app-trial fallback.
    await seedSubscription(orgId, { status: 'canceled', periodEnd: new Date(Date.now() - DAY) })

    const entitlement = await getOrgEntitlement(orgId)
    expect(entitlement.entitled).toBe(false)
    expect(entitlement.status).toBe('canceled')
  })

  it('prefers a currently-entitled row when several exist for the org', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await ageOrg(orgId, 60)
    await seedSubscription(orgId, { status: 'canceled', periodEnd: new Date(Date.now() - 10 * DAY) })
    await seedSubscription(orgId, { status: 'active', plan: 'starter', periodEnd: new Date(Date.now() + 10 * DAY) })

    const entitlement = await getOrgEntitlement(orgId)
    expect(entitlement.entitled).toBe(true)
    expect(entitlement.status).toBe('active')
    expect(entitlement.planId).toBe('starter')
  })

  it('is tenant-scoped: one school\'s subscription never entitles another', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    const other = await signUp({ email: uniqueEmail('other') })
    const otherOrgId = await createOrg(other, { name: 'Rival', slug: 'rival' })

    await ageOrg(orgId, 30)
    await ageOrg(otherOrgId, 30)
    // Only Ace has an active subscription.
    await seedSubscription(orgId, { status: 'active' })

    expect((await getOrgEntitlement(orgId)).entitled).toBe(true)
    expect((await getOrgEntitlement(otherOrgId)).entitled).toBe(false)
  })
})
