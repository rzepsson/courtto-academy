import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import { getPaymentAccount, startOnboarding } from '../../server/utils/services/payments'
import { clearPaymentsStripe, setPaymentsStripe } from '../../server/utils/payments-config'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

interface FakeAccount {
  id: string
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
}

// A recording fake Stripe (mirrors the mailer's recording transport): the tests
// never reach the real Stripe. It tracks created accounts so we can assert
// idempotency and flip an account's flags to simulate Stripe completing onboarding.
function makeFakeStripe() {
  const store = new Map<string, FakeAccount>()
  let created = 0

  const stripe = {
    accounts: {
      create: async () => {
        created += 1
        const account: FakeAccount = { id: `acct_test_${created}`, charges_enabled: false, payouts_enabled: false, details_submitted: false }
        store.set(account.id, account)
        return account
      },
      retrieve: async (id: string) => {
        const account = store.get(id)
        if (!account) throw new Error(`No such account: ${id}`)
        return account
      }
    },
    accountLinks: {
      create: async ({ account }: { account: string }) => ({ url: `https://connect.stripe.test/onboard/${account}` })
    }
  }

  return {
    stripe: stripe as unknown as Stripe,
    createdCount: () => created,
    enable: (id: string) => {
      const account = store.get(id)
      if (account) {
        account.charges_enabled = true
        account.payouts_enabled = true
        account.details_submitted = true
      }
    },
    firstAccountId: () => [...store.keys()][0]
  }
}

const ONBOARD_URLS = { returnUrl: 'https://app.test/return', refreshUrl: 'https://app.test/refresh' }

let fake: ReturnType<typeof makeFakeStripe>

describe.skipIf(!hasTestDb)('payments service (Stripe Connect)', () => {
  beforeEach(async () => {
    await resetDb()
    fake = makeFakeStripe()
    setPaymentsStripe(fake.stripe)
  })

  afterEach(() => {
    clearPaymentsStripe()
  })

  it('creates the connected account exactly once and returns an onboarding link', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}` })

    const first = await startOnboarding(orgId, ONBOARD_URLS)
    expect(first.url).toContain('connect.stripe.test/onboard/acct_test_1')
    expect(fake.createdCount()).toBe(1)

    // Fresh account can't charge yet.
    const account = await getPaymentAccount(orgId)
    expect(account.status).toBe('pending')
    expect(account.chargesEnabled).toBe(false)

    // Resuming onboarding reuses the stored account — never creates a second one.
    const second = await startOnboarding(orgId, ONBOARD_URLS)
    expect(second.url).toContain('acct_test_1')
    expect(fake.createdCount()).toBe(1)
  })

  it('becomes ready once Stripe enables charges (live sync on read)', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}` })

    await startOnboarding(orgId, ONBOARD_URLS)
    fake.enable(fake.firstAccountId()) // Stripe finishes verification

    const account = await getPaymentAccount(orgId)
    expect(account.status).toBe('ready')
    expect(account.chargesEnabled).toBe(true)
    expect(account.payoutsEnabled).toBe(true)
  })

  it('is tenant-scoped — one school\'s account never reflects another\'s', async () => {
    const ownerA = await signUp()
    const orgA = await createOrg(ownerA, { name: 'Ace', slug: `ace-${Date.now()}` })
    const ownerB = await signUp()
    const orgB = await createOrg(ownerB, { name: 'Rival', slug: `rival-${Date.now()}` })

    await startOnboarding(orgA, ONBOARD_URLS)
    await startOnboarding(orgB, ONBOARD_URLS)
    expect(fake.createdCount()).toBe(2)

    // Only A completes verification.
    fake.enable('acct_test_1')

    const a = await getPaymentAccount(orgA)
    const b = await getPaymentAccount(orgB)
    expect(a.status).toBe('ready')
    expect(b.status).toBe('pending')
  })

  it('reports none for a school that never started onboarding', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Solo', slug: `solo-${Date.now()}` })

    const account = await getPaymentAccount(orgId)
    expect(account.status).toBe('none')
    expect(account.chargesEnabled).toBe(false)
  })
})
