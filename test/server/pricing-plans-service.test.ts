import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import {
  archivePricingPlan,
  createPricingPlan,
  listPricingPlans,
  restorePricingPlan,
  updatePricingPlan
} from '../../server/utils/services/pricingPlans'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { clearPaymentsStripe, setPaymentsStripe } from '../../server/utils/payments-config'
import { db } from '../../server/utils/db'
import { orgPaymentAccount } from '../../server/database/app-schema'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

// A recording fake Stripe covering the Product/Price calls the pricing-plan service
// makes on the connected account. Records call counts + args so we can assert the
// immutable-price behaviour (new price on amount change, old one deactivated).
function makeFakeStripe() {
  let productSeq = 0
  let priceSeq = 0
  const calls = {
    productCreate: 0,
    priceCreate: 0,
    productUpdate: [] as Array<{ id: string, params: Record<string, unknown> }>,
    priceUpdate: [] as Array<{ id: string, params: Record<string, unknown> }>,
    stripeAccounts: [] as string[]
  }

  const stripe = {
    products: {
      create: async (params: Record<string, unknown>, opts: { stripeAccount?: string }) => {
        productSeq += 1
        calls.productCreate += 1
        if (opts?.stripeAccount) calls.stripeAccounts.push(opts.stripeAccount)
        return { id: `prod_${productSeq}`, ...params }
      },
      update: async (id: string, params: Record<string, unknown>) => {
        calls.productUpdate.push({ id, params })
        return { id, ...params }
      }
    },
    prices: {
      create: async (params: Record<string, unknown>, opts: { stripeAccount?: string }) => {
        priceSeq += 1
        calls.priceCreate += 1
        if (opts?.stripeAccount) calls.stripeAccounts.push(opts.stripeAccount)
        return { id: `price_${priceSeq}`, active: true, ...params }
      },
      update: async (id: string, params: Record<string, unknown>) => {
        calls.priceUpdate.push({ id, params })
        return { id, ...params }
      }
    }
  }

  return { stripe: stripe as unknown as Stripe, calls }
}

let fake: ReturnType<typeof makeFakeStripe>
let seq = 0

async function seedSchool(withAccount = true): Promise<{ owner: SeededUser, orgId: string, accountId: string }> {
  seq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${seq}` })
  await upsertOrgProfile(orgId, { currency: 'PLN' })
  const accountId = `acct_test_${seq}`
  if (withAccount) {
    await db.insert(orgPaymentAccount).values({
      organizationId: orgId,
      stripeAccountId: accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true
    })
  }
  return { owner, orgId, accountId }
}

describe.skipIf(!hasTestDb)('pricing plans service', () => {
  beforeEach(async () => {
    await resetDb()
    fake = makeFakeStripe()
    setPaymentsStripe(fake.stripe)
  })

  afterEach(() => {
    clearPaymentsStripe()
  })

  it('creates a plan mirrored as a Stripe product + price on the connected account', async () => {
    const { owner, orgId, accountId } = await seedSchool()

    const plan = await createPricingPlan(orgId, { name: 'Junior 1×/week', description: 'One session weekly', amountMinor: 20000 }, owner.userId)

    expect(plan.name).toBe('Junior 1×/week')
    expect(plan.amountMinor).toBe(20000)
    expect(plan.currency).toBe('PLN')
    expect(fake.calls.productCreate).toBe(1)
    expect(fake.calls.priceCreate).toBe(1)
    // Everything was created ON the connected account (direct-charge model).
    expect(fake.calls.stripeAccounts).toContain(accountId)

    const plans = await listPricingPlans(orgId)
    expect(plans).toHaveLength(1)
    expect(plans[0]!.id).toBe(plan.id)
  })

  it('refuses to create a plan before a connected account exists', async () => {
    const { owner, orgId } = await seedSchool(false)
    await expect(
      createPricingPlan(orgId, { name: 'X', description: '', amountMinor: 100 }, owner.userId)
    ).rejects.toMatchObject({ data: { code: 'PAYMENTS_ACCOUNT_REQUIRED' } })
  })

  it('changing the amount creates a NEW price and deactivates the old (immutable price)', async () => {
    const { owner, orgId } = await seedSchool()
    const plan = await createPricingPlan(orgId, { name: 'Junior', description: '', amountMinor: 20000 }, owner.userId)
    expect(fake.calls.priceCreate).toBe(1)

    const updated = await updatePricingPlan(orgId, plan.id, { amountMinor: 25000 })
    expect(updated?.amountMinor).toBe(25000)
    // A second price was created, and the first (price_1) was deactivated.
    expect(fake.calls.priceCreate).toBe(2)
    expect(fake.calls.priceUpdate).toContainEqual({ id: 'price_1', params: { active: false } })
  })

  it('updating the name mutates the Stripe product in place (no new price)', async () => {
    const { owner, orgId } = await seedSchool()
    const plan = await createPricingPlan(orgId, { name: 'Junior', description: '', amountMinor: 20000 }, owner.userId)

    const updated = await updatePricingPlan(orgId, plan.id, { name: 'Junior Pro' })
    expect(updated?.name).toBe('Junior Pro')
    expect(fake.calls.productUpdate).toContainEqual({ id: 'prod_1', params: { name: 'Junior Pro' } })
    expect(fake.calls.priceCreate).toBe(1) // unchanged — name edit never touches the price
  })

  it('archives (soft-delete, deactivates Stripe) and restores', async () => {
    const { owner, orgId } = await seedSchool()
    const plan = await createPricingPlan(orgId, { name: 'Junior', description: '', amountMinor: 20000 }, owner.userId)

    await archivePricingPlan(orgId, plan.id)
    expect(await listPricingPlans(orgId)).toHaveLength(0) // hidden by default
    expect(await listPricingPlans(orgId, { includeArchived: true })).toHaveLength(1)
    expect(fake.calls.priceUpdate).toContainEqual({ id: 'price_1', params: { active: false } })

    const restored = await restorePricingPlan(orgId, plan.id)
    expect(restored?.archivedAt).toBeNull()
    expect(await listPricingPlans(orgId)).toHaveLength(1)
    expect(fake.calls.priceUpdate).toContainEqual({ id: 'price_1', params: { active: true } })
  })

  it('is tenant-scoped — one school never sees another\'s plans', async () => {
    const a = await seedSchool()
    const b = await seedSchool()
    await createPricingPlan(a.orgId, { name: 'A plan', description: '', amountMinor: 10000 }, a.owner.userId)
    await createPricingPlan(b.orgId, { name: 'B plan', description: '', amountMinor: 30000 }, b.owner.userId)

    const aPlans = await listPricingPlans(a.orgId)
    expect(aPlans).toHaveLength(1)
    expect(aPlans[0]!.name).toBe('A plan')
  })
})
