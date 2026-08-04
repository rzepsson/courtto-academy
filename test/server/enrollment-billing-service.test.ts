import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import {
  cancelEnrollmentSubscription,
  createBillingPortalSession,
  createCheckoutForEnrollment,
  getEnrollmentBilling,
  getSeriesBillingContext,
  listSeriesEnrollmentBilling,
  refundLatestPayment,
  stopBillingForEnrollments,
  syncEnrollmentSubscription
} from '../../server/utils/services/enrollmentBilling'
import { cancelEnrollment } from '../../server/utils/services/enrollment'
import { cancelSeries, purgeSeries } from '../../server/utils/services/schedule'
import { createMemberGuardian } from '../../server/utils/services/memberGuardians'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { clearPaymentsStripe, setPaymentsStripe } from '../../server/utils/payments-config'
import { clearMailTransport, setMailTransport } from '../../server/utils/mailer'
import { db } from '../../server/utils/db'
import { listPaymentAudit } from '../../server/utils/services/paymentAudit'
import { enrollment, enrollmentBilling, lessonSeries, memberGuardian, memberProfile, notification, orgPaymentAccount, paymentAudit, pricingPlan } from '../../server/database/app-schema'
import { addMember, createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

interface FakeSub { id: string, status: string, current_period_end: number, metadata: Record<string, string>, cancel_at_period_end: boolean, latest_invoice: string }

// A recording fake Stripe covering the enrollment-billing calls. Checkout creation
// records the intended subscription (so a later retrieve simulates the parent having
// completed payment). Never reaches real Stripe.
function makeFakeStripe() {
  const subscriptions = new Map<string, FakeSub>()
  const refundsByKey = new Map<string, { id: string }>()
  const calls = { customerCreate: 0, checkoutCreate: 0, refundCreate: 0, cancelled: [] as string[], expired: [] as string[], updated: [] as Array<{ id: string, params: Record<string, unknown> }>, lastCheckout: null as Record<string, unknown> | null }
  let cusSeq = 0
  let sesSeq = 0

  const stripe = {
    customers: {
      create: async (params: Record<string, unknown>) => {
        cusSeq += 1
        calls.customerCreate += 1
        return { id: `cus_${cusSeq}`, ...params }
      }
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          sesSeq += 1
          calls.checkoutCreate += 1
          calls.lastCheckout = params
          const subId = `sub_${sesSeq}`
          const metadata = (params.subscription_data as { metadata?: Record<string, string> } | undefined)?.metadata ?? {}
          subscriptions.set(subId, { id: subId, status: 'active', current_period_end: 1_893_456_000, metadata, cancel_at_period_end: false, latest_invoice: `inv_${sesSeq}` })
          return { id: `cs_${sesSeq}`, url: `https://checkout.stripe.test/${sesSeq}`, subscription: subId }
        },
        expire: async (id: string) => {
          calls.expired.push(id)
          return { id, status: 'expired' }
        }
      }
    },
    subscriptions: {
      retrieve: async (id: string) => {
        const s = subscriptions.get(id)
        if (!s) throw new Error('no sub')
        return s
      },
      update: async (id: string, params: Record<string, unknown>) => {
        calls.updated.push({ id, params })
        const s = subscriptions.get(id)
        if (s && typeof params.cancel_at_period_end === 'boolean') s.cancel_at_period_end = params.cancel_at_period_end
        return s ?? { id }
      },
      cancel: async (id: string) => {
        calls.cancelled.push(id)
        const s = subscriptions.get(id)
        if (s) s.status = 'canceled'
        return s ?? { id }
      }
    },
    invoices: {
      retrieve: async (id: string) => ({ id, payment_intent: `pi_${id}` })
    },
    refunds: {
      // Models Stripe idempotency: the same key returns the cached refund instead of
      // issuing a second one.
      create: async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey
        if (key && refundsByKey.has(key)) return refundsByKey.get(key)!
        calls.refundCreate += 1
        const refund = { id: `re_${calls.refundCreate}`, amount: 20000, currency: 'pln', ...params }
        if (key) refundsByKey.set(key, refund)
        return refund
      }
    },
    billingPortal: {
      sessions: {
        create: async (params: { customer: string }) => ({ url: `https://portal.stripe.test/${params.customer}` })
      }
    }
  }

  function setStatus(id: string, status: string): void {
    const s = subscriptions.get(id)
    if (s) s.status = status
  }

  function addSubscription(id: string, metadata: Record<string, string>): void {
    subscriptions.set(id, { id, status: 'active', current_period_end: 1_893_456_000, metadata, cancel_at_period_end: false, latest_invoice: `inv_${id}` })
  }

  return { stripe: stripe as unknown as Stripe, calls, setStatus, addSubscription }
}

const ACCOUNT_ID = 'acct_test_billing'
const URLS = { successUrl: 'https://app.test/pay/success', cancelUrl: 'https://app.test/pay/cancel' }
const ACTOR = { memberId: 'm_staff', name: 'Staff' }
const MINOR_DOB = '2013-01-01'
const ADULT_DOB = '1990-01-01'

let fake: ReturnType<typeof makeFakeStripe>
let sent: Array<{ to: string }>
let seq = 0

interface Group { orgId: string, enrollmentId: string, studentMemberId: string, planId: string, seriesId: string }

async function seedGroup(options: { minor: boolean, guardian?: boolean, ready?: boolean, withPlan?: boolean } = { minor: false }): Promise<Group> {
  seq += 1
  const owner = await signUp()
  const orgId = await createOrg(owner, { name: 'Ace', slug: `ace-${Date.now()}-${seq}` })
  await upsertOrgProfile(orgId, { currency: 'PLN', locale: 'pl' })

  await db.insert(orgPaymentAccount).values({
    organizationId: orgId,
    stripeAccountId: `${ACCOUNT_ID}_${seq}`,
    chargesEnabled: options.ready !== false,
    payoutsEnabled: options.ready !== false,
    detailsSubmitted: options.ready !== false
  })

  const planId = randomUUID()
  await db.insert(pricingPlan).values({
    id: planId, organizationId: orgId, name: 'Junior', amountMinor: 20000, currency: 'PLN',
    stripeProductId: 'prod_seed', stripePriceId: 'price_seed'
  })

  const seriesId = randomUUID()
  await db.insert(lessonSeries).values({
    id: seriesId, organizationId: orgId, type: 'group', sport: 'tennis', title: 'Grupa A',
    color: '#00C16A', timezone: 'Europe/Warsaw', pricingPlanId: options.withPlan === false ? null : planId
  })

  const student = await signUp({ email: uniqueEmail('stu') })
  const studentMemberId = await addMember(orgId, student.userId, 'student')
  await upsertMemberProfile(orgId, studentMemberId, { dateOfBirth: options.minor ? MINOR_DOB : ADULT_DOB })

  if (options.minor && options.guardian !== false) {
    await createMemberGuardian(orgId, studentMemberId, { name: 'Parent', relationship: 'mother', phone: '', email: 'parent@ex.com', isPrimary: true, notes: '' })
  }

  const enrollmentId = randomUUID()
  await db.insert(enrollment).values({ id: enrollmentId, organizationId: orgId, studentMemberId, seriesId, status: 'enrolled' })

  return { orgId, enrollmentId, studentMemberId, planId, seriesId }
}

async function accountId(orgId: string): Promise<string> {
  const [row] = await db.select({ id: orgPaymentAccount.stripeAccountId }).from(orgPaymentAccount).where(eq(orgPaymentAccount.organizationId, orgId)).limit(1)
  return row!.id
}

describe.skipIf(!hasTestDb)('enrollment billing service', () => {
  beforeEach(async () => {
    await resetDb()
    fake = makeFakeStripe()
    setPaymentsStripe(fake.stripe)
    sent = []
    setMailTransport({ name: 'recording', send: async mail => void sent.push({ to: mail.to }) })
  })

  afterEach(() => {
    clearPaymentsStripe()
    clearMailTransport()
  })

  it('creates a subscription-mode Checkout for an adult student and emails the payer', async () => {
    const group = await seedGroup({ minor: false })
    const { url } = await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)

    expect(url).toContain('checkout.stripe.test')
    expect(fake.calls.checkoutCreate).toBe(1)
    expect(fake.calls.customerCreate).toBe(1)
    // Correct Checkout shape: subscription mode, the plan's price, enrolment metadata,
    // and NO application fee at the default 0%.
    const params = fake.calls.lastCheckout!
    expect(params.mode).toBe('subscription')
    expect(params.line_items).toEqual([{ price: 'price_seed', quantity: 1 }])
    expect((params.subscription_data as { metadata: Record<string, string> }).metadata.enrollmentId).toBe(group.enrollmentId)
    expect((params.subscription_data as Record<string, unknown>).application_fee_percent).toBeUndefined()

    const billing = await getEnrollmentBilling(group.orgId, group.enrollmentId)
    expect(billing?.status).toBe('pending_payment')
    expect(sent).toHaveLength(1)

    // The adult student's Stripe customer is stored on their profile for reuse.
    const [profile] = await db.select({ cus: memberProfile.stripeCustomerId }).from(memberProfile).where(eq(memberProfile.memberId, group.studentMemberId)).limit(1)
    expect(profile?.cus).toBe('cus_1')
  })

  it('reuses the payer\'s Stripe customer on a second checkout', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    expect(fake.calls.customerCreate).toBe(1) // customer created once, reused
    expect(fake.calls.checkoutCreate).toBe(2)
  })

  it('bills a minor through their primary guardian (customer stored on the guardian)', async () => {
    const group = await seedGroup({ minor: true, guardian: true })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)

    const [guardian] = await db.select({ cus: memberGuardian.stripeCustomerId, email: memberGuardian.email })
      .from(memberGuardian).where(and(eq(memberGuardian.organizationId, group.orgId), eq(memberGuardian.memberId, group.studentMemberId))).limit(1)
    expect(guardian?.cus).toBe('cus_1')
    expect(sent[0]!.to).toBe('parent@ex.com')
  })

  it('refuses to bill a minor with no primary guardian', async () => {
    const group = await seedGroup({ minor: true, guardian: false })
    await expect(createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS))
      .rejects.toMatchObject({ data: { code: 'PAYER_NO_GUARDIAN' } })
  })

  it('refuses when the group has no plan, or the account can\'t charge, or it\'s already active', async () => {
    const noPlan = await seedGroup({ minor: false, withPlan: false })
    await expect(createCheckoutForEnrollment(noPlan.orgId, noPlan.enrollmentId, URLS)).rejects.toMatchObject({ data: { code: 'SERIES_PLAN_NOT_SET' } })

    const notReady = await seedGroup({ minor: false, ready: false })
    await expect(createCheckoutForEnrollment(notReady.orgId, notReady.enrollmentId, URLS)).rejects.toMatchObject({ data: { code: 'PAYMENTS_ACCOUNT_NOT_READY' } })

    const active = await seedGroup({ minor: false })
    await db.insert(enrollmentBilling).values({ enrollmentId: active.enrollmentId, organizationId: active.orgId, status: 'active', stripeSubscriptionId: 'sub_existing' })
    await expect(createCheckoutForEnrollment(active.orgId, active.enrollmentId, URLS)).rejects.toMatchObject({ data: { code: 'BILLING_ALREADY_ACTIVE' } })
  })

  it('mirrors the subscription lifecycle from webhooks (active → past_due → canceled)', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    const acct = await accountId(group.orgId)

    await syncEnrollmentSubscription(acct, 'sub_1')
    expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('active')
    expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.currentPeriodEnd).toBeInstanceOf(Date)

    fake.setStatus('sub_1', 'past_due')
    await syncEnrollmentSubscription(acct, 'sub_1')
    expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('past_due')

    fake.setStatus('sub_1', 'canceled')
    await syncEnrollmentSubscription(acct, 'sub_1')
    expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('canceled')
  })

  it('guards against a double subscription — cancels the duplicate, keeps the first', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    const acct = await accountId(group.orgId)
    await syncEnrollmentSubscription(acct, 'sub_1') // now active on sub_1

    // A second subscription arrives for the same enrolment (e.g. two links completed).
    fake.addSubscription('sub_dup', { enrollmentId: group.enrollmentId, organizationId: group.orgId })
    await syncEnrollmentSubscription(acct, 'sub_dup')

    expect(fake.calls.cancelled).toContain('sub_dup')
    // The row still points at the first subscription and stays active.
    const [row] = await db.select({ sub: enrollmentBilling.stripeSubscriptionId, status: enrollmentBilling.status })
      .from(enrollmentBilling).where(eq(enrollmentBilling.enrollmentId, group.enrollmentId)).limit(1)
    expect(row?.sub).toBe('sub_1')
    expect(row?.status).toBe('active')
  })

  it('is tenant-scoped — a subscription tagged with another org never updates this one', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    const acct = await accountId(group.orgId)

    // A subscription carrying THIS enrolment id but a DIFFERENT org must not match.
    fake.addSubscription('sub_evil', { enrollmentId: group.enrollmentId, organizationId: 'org_other' })
    await syncEnrollmentSubscription(acct, 'sub_evil')

    // Still pending — the cross-org event changed nothing.
    expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('pending_payment')
  })

  it('exposes the billing context (plan + payments readiness) for the group editor', async () => {
    const group = await seedGroup({ minor: false })
    const ctx = await getSeriesBillingContext(group.orgId, group.seriesId)
    expect(ctx.plan?.id).toBe(group.planId)
    expect(ctx.plan?.amountMinor).toBe(20000)
    expect(ctx.paymentsReady).toBe(true)

    const notReady = await seedGroup({ minor: false, ready: false })
    expect((await getSeriesBillingContext(notReady.orgId, notReady.seriesId)).paymentsReady).toBe(false)
  })

  it('lists per-enrolment billing status for the roster', async () => {
    const group = await seedGroup({ minor: false })
    expect(await listSeriesEnrollmentBilling(group.orgId, group.seriesId)).toEqual({})

    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    expect((await listSeriesEnrollmentBilling(group.orgId, group.seriesId))[group.enrollmentId]?.status).toBe('pending_payment')

    await syncEnrollmentSubscription(await accountId(group.orgId), 'sub_1')
    expect((await listSeriesEnrollmentBilling(group.orgId, group.seriesId))[group.enrollmentId]?.status).toBe('active')
  })

  it('opens a Customer Portal session only once a customer exists', async () => {
    const group = await seedGroup({ minor: false })
    await expect(createBillingPortalSession(group.orgId, group.enrollmentId, 'https://app.test/back'))
      .rejects.toMatchObject({ data: { code: 'BILLING_NO_CUSTOMER' } })

    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    const { url } = await createBillingPortalSession(group.orgId, group.enrollmentId, 'https://app.test/back')
    expect(url).toContain('portal.stripe.test/cus_1')
  })

  it('cancels at period end (spot stays active, marked ending) and immediately', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    const acct = await accountId(group.orgId)
    await syncEnrollmentSubscription(acct, 'sub_1')

    const atEnd = await cancelEnrollmentSubscription(group.orgId, group.enrollmentId)
    expect(fake.calls.updated).toContainEqual({ id: 'sub_1', params: { cancel_at_period_end: true } })
    expect(atEnd?.status).toBe('active') // still paid through the period
    expect(atEnd?.cancelAtPeriodEnd).toBe(true)

    const now = await cancelEnrollmentSubscription(group.orgId, group.enrollmentId, { immediately: true })
    expect(fake.calls.cancelled).toContain('sub_1')
    expect(now?.status).toBe('canceled')
  })

  it('refuses to cancel or refund when there is no subscription', async () => {
    const group = await seedGroup({ minor: false })
    await expect(cancelEnrollmentSubscription(group.orgId, group.enrollmentId)).rejects.toMatchObject({ data: { code: 'BILLING_NO_SUBSCRIPTION' } })
    await expect(refundLatestPayment(group.orgId, group.enrollmentId)).rejects.toMatchObject({ data: { code: 'BILLING_NO_SUBSCRIPTION' } })
  })

  it('refunds the latest payment once, idempotently — never twice for the same invoice', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    await syncEnrollmentSubscription(await accountId(group.orgId), 'sub_1')

    expect(await refundLatestPayment(group.orgId, group.enrollmentId)).toEqual({ refunded: true })
    // A second refund of the SAME invoice must not issue a second refund (idempotency key).
    await refundLatestPayment(group.orgId, group.enrollmentId)
    expect(fake.calls.refundCreate).toBe(1)
  })

  it('alerts staff on the transition into past_due, once per episode', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
    const acct = await accountId(group.orgId)
    await syncEnrollmentSubscription(acct, 'sub_1') // active

    fake.setStatus('sub_1', 'past_due')
    await syncEnrollmentSubscription(acct, 'sub_1')

    const failedFor = () => db
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.organizationId, group.orgId), eq(notification.type, 'billing.payment_failed')))

    // One alert to the owner (the only staff member here).
    expect((await failedFor()).length).toBe(1)

    // A Stripe retry (still past_due) must NOT re-notify — the transition guard holds.
    await syncEnrollmentSubscription(acct, 'sub_1')
    expect((await failedFor()).length).toBe(1)
  })

  it('records a money-audit entry for each staff operation (actor + amount)', async () => {
    const group = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS, ACTOR)
    await syncEnrollmentSubscription(await accountId(group.orgId), 'sub_1')
    await cancelEnrollmentSubscription(group.orgId, group.enrollmentId, {}, ACTOR)
    await refundLatestPayment(group.orgId, group.enrollmentId, ACTOR)

    const entries = await listPaymentAudit(group.orgId)
    const actions = entries.map(entry => entry.action)
    expect(actions).toContain('checkout_sent')
    expect(actions).toContain('subscription_canceled')
    expect(actions).toContain('refund_issued')
    expect(entries.every(entry => entry.actorName === 'Staff')).toBe(true)

    // The refund entry carries the money moved (integer minor units) + currency.
    const refund = entries.find(entry => entry.action === 'refund_issued')!
    expect(refund.amountMinor).toBe(20000)
    expect(refund.currency).toBe('pln')
  })

  it('the money-audit trail is tenant-scoped, and is skipped without an actor', async () => {
    const a = await seedGroup({ minor: false })
    const b = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(a.orgId, a.enrollmentId, URLS, ACTOR)
    // No actor (a non-request caller) → no trail entry.
    await createCheckoutForEnrollment(b.orgId, b.enrollmentId, URLS)

    expect((await listPaymentAudit(a.orgId)).length).toBe(1)
    expect((await listPaymentAudit(b.orgId)).length).toBe(0)
  })

  it('ignores a subscription whose metadata names an org that does not own the event account', async () => {
    const a = await seedGroup({ minor: false })
    const b = await seedGroup({ minor: false })
    await createCheckoutForEnrollment(a.orgId, a.enrollmentId, URLS)

    // A school controls its own connected account, so it could mint a subscription
    // whose metadata points at ANOTHER school's enrolment. The event fires on b's
    // account; binding metadata to the account owner must reject it.
    fake.addSubscription('sub_forged', { enrollmentId: a.enrollmentId, organizationId: a.orgId })
    await syncEnrollmentSubscription(await accountId(b.orgId), 'sub_forged')

    // a's billing is untouched — still awaiting its own payment.
    expect((await getEnrollmentBilling(a.orgId, a.enrollmentId))?.status).toBe('pending_payment')
  })

  // A spot that ends must stop charging the family. These cover every path that ends
  // one — the regression that matters most here is the SILENT one: before this, a
  // cancelled enrolment vanished from the staff panel (so the manual "cancel billing"
  // action became unreachable) while Stripe kept billing monthly, and a purged group
  // additionally cascaded the subscription id out of the database entirely.
  describe('billing stops when the spot ends', () => {
    async function seedBilledGroup(): Promise<Group> {
      const group = await seedGroup({ minor: false })
      await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
      await syncEnrollmentSubscription(await accountId(group.orgId), 'sub_1')
      expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('active')
      return group
    }

    it('stops billing when staff cancel the enrolment', async () => {
      const group = await seedBilledGroup()

      await cancelEnrollment(group.orgId, group.enrollmentId, undefined, ACTOR)

      expect(fake.calls.updated).toContainEqual({ id: 'sub_1', params: { cancel_at_period_end: true } })
      const billing = await getEnrollmentBilling(group.orgId, group.enrollmentId)
      expect(billing?.cancelAtPeriodEnd).toBe(true)

      // ...and the stop is on the money trail, attributed to whoever ended the spot.
      const entries = await listPaymentAudit(group.orgId)
      expect(entries.some(entry => entry.action === 'subscription_canceled' && entry.actorName === 'Staff')).toBe(true)
    })

    it('stops billing when the STUDENT cancels their own spot in /my', async () => {
      const group = await seedBilledGroup()

      // The student's own cancel takes the ownership arg — the path staff never sees.
      await cancelEnrollment(group.orgId, group.enrollmentId, group.studentMemberId)

      expect(fake.calls.updated).toContainEqual({ id: 'sub_1', params: { cancel_at_period_end: true } })
      expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.cancelAtPeriodEnd).toBe(true)
    })

    it('does not stop twice when an already-cancelled enrolment is cancelled again', async () => {
      const group = await seedBilledGroup()

      await cancelEnrollment(group.orgId, group.enrollmentId)
      await cancelEnrollment(group.orgId, group.enrollmentId)

      const stops = fake.calls.updated.filter(call => call.params.cancel_at_period_end === true)
      expect(stops).toHaveLength(1)
      expect((await listPaymentAudit(group.orgId)).filter(entry => entry.action === 'subscription_canceled')).toHaveLength(1)
    })

    it('expires an unpaid Checkout link so it can never subscribe a payer to a dead spot', async () => {
      const group = await seedGroup({ minor: false })
      await createCheckoutForEnrollment(group.orgId, group.enrollmentId, URLS)
      // Never completed — pending_payment, no subscription yet.
      expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('pending_payment')

      await cancelEnrollment(group.orgId, group.enrollmentId)

      expect(fake.calls.expired).toEqual(['cs_1'])
      expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.status).toBe('canceled')
    })

    it('stops billing for every spot when the whole group is called off', async () => {
      const group = await seedBilledGroup()

      await cancelSeries(group.orgId, group.seriesId, 'coach left', ACTOR)

      expect(fake.calls.updated).toContainEqual({ id: 'sub_1', params: { cancel_at_period_end: true } })
      expect((await getEnrollmentBilling(group.orgId, group.enrollmentId))?.cancelAtPeriodEnd).toBe(true)
    })

    it('stops billing BEFORE a purge, leaving the subscription id on a trail that survives the delete', async () => {
      const group = await seedBilledGroup()

      await purgeSeries(group.orgId, group.seriesId, ACTOR)

      expect(fake.calls.updated).toContainEqual({ id: 'sub_1', params: { cancel_at_period_end: true } })
      // The enrolment and its billing row are gone with the group...
      expect(await getEnrollmentBilling(group.orgId, group.enrollmentId)).toBeNull()
      const [survivor] = await db
        .select({ id: enrollment.id })
        .from(enrollment)
        .where(eq(enrollment.id, group.enrollmentId))
        .limit(1)
      expect(survivor).toBeUndefined()

      // ...but the money trail keeps the subscription id for reconciliation, which is
      // the only record left that this family was ever being charged.
      const [row] = await db
        .select({ action: paymentAudit.action, stripeRef: paymentAudit.stripeRef })
        .from(paymentAudit)
        .where(and(eq(paymentAudit.organizationId, group.orgId), eq(paymentAudit.action, 'subscription_canceled')))
        .limit(1)
      expect(row?.stripeRef).toBe('sub_1')
    })

    it('does not fail the cancellation when Stripe is unreachable', async () => {
      const group = await seedBilledGroup()
      fake.stripe.subscriptions.update = (async () => {
        throw new Error('stripe down')
      }) as unknown as typeof fake.stripe.subscriptions.update

      // Best-effort: ending the spot still succeeds (the failure is captured, and the
      // row keeps its subscription id so a retry can still stop it).
      const cancelled = await cancelEnrollment(group.orgId, group.enrollmentId)
      expect(cancelled?.status).toBe('cancelled')
    })

    it('is tenant-scoped — ending a spot never touches another school\'s billing', async () => {
      const a = await seedBilledGroup()
      const b = await seedGroup({ minor: false })
      await createCheckoutForEnrollment(b.orgId, b.enrollmentId, URLS)
      await syncEnrollmentSubscription(await accountId(b.orgId), 'sub_2')

      await stopBillingForEnrollments(a.orgId, [a.enrollmentId, b.enrollmentId])

      // b's enrolment id was passed but belongs to another org → untouched.
      expect((await getEnrollmentBilling(b.orgId, b.enrollmentId))?.cancelAtPeriodEnd).toBe(false)
      expect(fake.calls.updated.map(call => call.id)).toEqual(['sub_1'])
    })
  })
})
