import type StripeNS from 'stripe'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '../db'
import {
  enrollment,
  enrollmentBilling,
  lessonSeries,
  memberGuardian,
  memberProfile,
  orgPaymentAccount,
  pricingPlan
} from '../../database/app-schema'
import { member, organization, user } from '../../database/schema'
import type { EnrollmentBillingDto, EnrollmentBillingSummary, SeriesBillingContext } from '../../database/types'
import { canCollectPayments, resolvePaymentAccountStatus } from '../../../shared/payments'
import { isEnrollmentBillingStatus, mapStripeSubscriptionStatus } from '../../../shared/enrollment-billing'
import { isMinor } from '../../../shared/member-guardian'
import { renderPaymentLinkEmail, toEmailLocale } from '../../../shared/email'
import { paymentsStripe, platformFeePercent } from '../payments-config'
import { captureError } from '../monitoring'
import { sendMail } from '../mailer'
import { getOrgProfile } from './orgProfile'
import { notifyPaymentFailed } from './paymentNotifications'
import { recordPaymentAudit } from './paymentAudit'

// The acting staff member for an audited money operation (resolved by the endpoint
// from the session). Optional on the service so non-request callers (tests) can skip
// the trail; every production endpoint passes it.
export interface StaffActor {
  memberId: string
  name: string | null
}

// Snapshot the student's name for the money-audit trail (the enrolment may later be
// deleted, so the name is stored, not resolved on read).
async function studentNameFor(organizationId: string, enrollmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: user.name })
    .from(enrollment)
    .innerJoin(member, eq(enrollment.studentMemberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, enrollmentId)))
    .limit(1)
  return row?.name ?? null
}

// Enrollment billing service — ACADEMY. Turns a student's enrolment in a priced
// group into a Stripe Checkout link (subscription mode) on the school's CONNECTED
// account, and mirrors the resulting subscription's state from webhooks. MONEY-
// CRITICAL: Stripe is the source of truth (state is only ever set FROM a retrieved
// subscription), every Stripe call is on the connected account, and access is never
// gated on payment (the locked policy). Every query is scoped by organizationId.

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}
function notFound(message: string, code: string): never {
  throw createError({ statusCode: 404, statusMessage: message, data: { code } })
}
function conflict(message: string, code: string): never {
  throw createError({ statusCode: 409, statusMessage: message, data: { code } })
}
function stripeFailed(error: unknown, organizationId: string, op: string): never {
  captureError(error, { scope: `payments.enrollmentBilling.${op}`, organizationId })
  throw createError({ statusCode: 502, statusMessage: 'Stripe request failed', data: { code: 'PAYMENTS_STRIPE_ERROR' } })
}

// `current_period_end` lives on the subscription in older API shapes and on the
// item in newer ones — read whichever is present so a Stripe API-version change
// can't silently null the paid-through date.
function subscriptionPeriodEnd(sub: StripeNS.Subscription): Date | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end
  const item = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end
  const seconds = typeof top === 'number' ? top : item
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null
}

// ── Assign a plan to a group ────────────────────────────────────────────────

export async function setSeriesPlan(
  organizationId: string,
  seriesId: string,
  pricingPlanId: string | null
): Promise<void> {
  const [series] = await db
    .select({ id: lessonSeries.id })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)
  if (!series) {
    notFound('Group not found', 'SCHEDULE_SERIES_NOT_FOUND')
  }

  if (pricingPlanId) {
    const [plan] = await db
      .select({ id: pricingPlan.id, archivedAt: pricingPlan.archivedAt })
      .from(pricingPlan)
      .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, pricingPlanId)))
      .limit(1)
    if (!plan) {
      notFound('Plan not found', 'PRICING_PLAN_NOT_FOUND')
    }
    if (plan.archivedAt) {
      bad('Plan is archived', 'PRICING_PLAN_ARCHIVED')
    }
  }

  await db
    .update(lessonSeries)
    .set({ pricingPlanId })
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function getEnrollmentBilling(
  organizationId: string,
  enrollmentId: string
): Promise<EnrollmentBillingDto | null> {
  const [row] = await db
    .select({ enrollmentId: enrollmentBilling.enrollmentId, status: enrollmentBilling.status, currentPeriodEnd: enrollmentBilling.currentPeriodEnd, cancelAtPeriodEnd: enrollmentBilling.cancelAtPeriodEnd })
    .from(enrollmentBilling)
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, enrollmentId)))
    .limit(1)
  if (!row) {
    return null
  }
  return {
    enrollmentId: row.enrollmentId,
    status: mapStoredStatus(row.status),
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd
  }
}

function mapStoredStatus(value: string): EnrollmentBillingDto['status'] {
  // A stored value we don't recognise degrades to past_due (needs attention), never
  // optimistically active.
  return value === 'active' || value === 'pending_payment' || value === 'canceled' ? value : 'past_due'
}

// ── Create the Checkout link ────────────────────────────────────────────────

interface Payer {
  kind: 'guardian' | 'member'
  guardianId: string | null
  email: string
  name: string
  existingCustomerId: string | null
}

export async function createCheckoutForEnrollment(
  organizationId: string,
  enrollmentId: string,
  urls: { successUrl: string, cancelUrl: string },
  actor?: StaffActor
): Promise<{ url: string }> {
  // 1. Enrolment must be this org's and hold a confirmed (not waitlisted) spot.
  const [enrol] = await db
    .select({ id: enrollment.id, studentMemberId: enrollment.studentMemberId, seriesId: enrollment.seriesId, status: enrollment.status })
    .from(enrollment)
    .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, enrollmentId)))
    .limit(1)
  if (!enrol) {
    notFound('Enrolment not found', 'ENROLLMENT_NOT_FOUND')
  }
  if (enrol.status !== 'enrolled') {
    bad('Only a confirmed enrolment can be billed', 'ENROLLMENT_NOT_ENROLLED')
  }
  if (!enrol.seriesId) {
    bad('Only a group enrolment can be billed', 'ENROLLMENT_NOT_SERIES')
  }

  // 2. The group must reference an active plan with a Stripe price.
  const [series] = await db
    .select({ id: lessonSeries.id, title: lessonSeries.title, pricingPlanId: lessonSeries.pricingPlanId })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, enrol.seriesId)))
    .limit(1)
  if (!series?.pricingPlanId) {
    bad('This group has no pricing plan', 'SERIES_PLAN_NOT_SET')
  }

  const [plan] = await db
    .select({ stripePriceId: pricingPlan.stripePriceId, amountMinor: pricingPlan.amountMinor, currency: pricingPlan.currency, archivedAt: pricingPlan.archivedAt })
    .from(pricingPlan)
    .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, series.pricingPlanId)))
    .limit(1)
  if (!plan || plan.archivedAt || !plan.stripePriceId) {
    bad('The group\'s pricing plan is unavailable', 'PRICING_PLAN_UNAVAILABLE')
  }

  // 3. The connected account must be able to charge — never send a link that can't collect.
  const [account] = await db
    .select({ stripeAccountId: orgPaymentAccount.stripeAccountId, chargesEnabled: orgPaymentAccount.chargesEnabled, payoutsEnabled: orgPaymentAccount.payoutsEnabled, detailsSubmitted: orgPaymentAccount.detailsSubmitted })
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  const ready = account && canCollectPayments(resolvePaymentAccountStatus({ hasAccount: true, ...account }))
  if (!account || !ready) {
    bad('Payments are not ready to collect', 'PAYMENTS_ACCOUNT_NOT_READY')
  }
  const accountId = account.stripeAccountId

  // 4. Don't create a second subscription for an already-active spot.
  const [existingBilling] = await db
    .select({ status: enrollmentBilling.status })
    .from(enrollmentBilling)
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, enrollmentId)))
    .limit(1)
  if (existingBilling?.status === 'active') {
    conflict('This enrolment is already being billed', 'BILLING_ALREADY_ACTIVE')
  }

  // 5. Resolve the payer: a minor's guardian, or the adult student themselves.
  const payer = await resolvePayer(organizationId, enrol.studentMemberId)

  // 6. Get-or-create the payer's Stripe Customer on the connected account (reused).
  const stripe = paymentsStripe()
  const options = { stripeAccount: accountId }
  let customerId = payer.existingCustomerId
  if (!customerId) {
    let customer: StripeNS.Customer
    try {
      customer = await stripe.customers.create(
        { email: payer.email, name: payer.name, metadata: { organizationId } },
        { ...options, idempotencyKey: `customer-${payer.kind}-${payer.guardianId ?? enrol.studentMemberId}` }
      )
    } catch (error) {
      stripeFailed(error, organizationId, 'customer.create')
    }
    customerId = customer.id
    await persistCustomerId(payer, enrol.studentMemberId, organizationId, customerId)
  }

  // 7. Create the subscription-mode Checkout session on the connected account.
  const fee = platformFeePercent()
  const subscriptionData: StripeNS.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: { enrollmentId, organizationId }
  }
  if (fee > 0) {
    subscriptionData.application_fee_percent = fee
  }

  let session: StripeNS.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        subscription_data: subscriptionData,
        success_url: urls.successUrl,
        cancel_url: urls.cancelUrl,
        metadata: { enrollmentId, organizationId }
      },
      options
    )
  } catch (error) {
    stripeFailed(error, organizationId, 'checkout.create')
  }
  if (!session.url) {
    stripeFailed(new Error('Checkout session has no URL'), organizationId, 'checkout.create')
  }

  // 8. Record the pending billing state.
  await db
    .insert(enrollmentBilling)
    .values({ enrollmentId, organizationId, status: 'pending_payment', stripeCustomerId: customerId, checkoutSessionId: session.id })
    .onConflictDoUpdate({
      target: enrollmentBilling.enrollmentId,
      set: { status: 'pending_payment', stripeCustomerId: customerId, checkoutSessionId: session.id }
    })

  // 9. Email the payer the link (best-effort — the endpoint also returns the URL, so
  // a mail failure never blocks the staff action).
  await emailPaymentLink(organizationId, payer, series.title, plan.amountMinor, plan.currency, session.url).catch((error) => {
    captureError(error, { scope: 'payments.enrollmentBilling.email', organizationId })
  })

  // 10. Record the money-audit trail (best-effort).
  if (actor) {
    await recordPaymentAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorName: actor.name,
      action: 'checkout_sent',
      enrollmentId,
      studentName: await studentNameFor(organizationId, enrollmentId),
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      stripeRef: session.id
    })
  }

  return { url: session.url }
}

async function resolvePayer(organizationId: string, studentMemberId: string): Promise<Payer> {
  const [student] = await db
    .select({ userName: user.name, userEmail: user.email, dateOfBirth: memberProfile.dateOfBirth, memberCustomerId: memberProfile.stripeCustomerId })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.id, studentMemberId)))
    .limit(1)
  if (!student) {
    notFound('Student not found', 'ENROLLMENT_STUDENT_NOT_FOUND')
  }

  if (isMinor(student.dateOfBirth)) {
    const [guardian] = await db
      .select({ id: memberGuardian.id, name: memberGuardian.name, email: memberGuardian.email, customerId: memberGuardian.stripeCustomerId })
      .from(memberGuardian)
      .where(and(eq(memberGuardian.organizationId, organizationId), eq(memberGuardian.memberId, studentMemberId), eq(memberGuardian.isPrimary, true)))
      .limit(1)
    if (!guardian) {
      bad('A minor needs a primary guardian to bill', 'PAYER_NO_GUARDIAN')
    }
    if (!guardian.email) {
      bad('The guardian has no email on file', 'PAYER_NO_EMAIL')
    }
    return { kind: 'guardian', guardianId: guardian.id, email: guardian.email, name: guardian.name, existingCustomerId: guardian.customerId }
  }

  // Adult student pays for themselves.
  return { kind: 'member', guardianId: null, email: student.userEmail, name: student.userName, existingCustomerId: student.memberCustomerId }
}

async function persistCustomerId(payer: Payer, studentMemberId: string, organizationId: string, customerId: string): Promise<void> {
  if (payer.kind === 'guardian' && payer.guardianId) {
    await db.update(memberGuardian).set({ stripeCustomerId: customerId }).where(eq(memberGuardian.id, payer.guardianId))
  } else {
    // The member may have no sidecar row yet — upsert just the customer id.
    await db
      .insert(memberProfile)
      .values({ memberId: studentMemberId, organizationId, stripeCustomerId: customerId })
      .onConflictDoUpdate({ target: memberProfile.memberId, set: { stripeCustomerId: customerId } })
  }
}

async function emailPaymentLink(
  organizationId: string,
  payer: Payer,
  groupTitle: string,
  amountMinor: number,
  currency: string,
  checkoutUrl: string
): Promise<void> {
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId)).limit(1)
  const profile = await getOrgProfile(organizationId)
  const email = renderPaymentLinkEmail({
    locale: toEmailLocale(profile.locale),
    schoolName: org?.name ?? 'Courtto',
    studentName: payer.name,
    groupTitle,
    amountMinor,
    currency,
    checkoutUrl
  })
  await sendMail({ to: payer.email, subject: email.subject, html: email.html, text: email.text })
}

// ── Webhook state machine ───────────────────────────────────────────────────

// Mirror a subscription's CURRENT state onto its enrolment billing row. Called for
// every subscription-related Connect event (checkout completed, subscription
// updated/deleted, invoice paid/failed). Order-independent + idempotent BY DESIGN:
// it retrieves the live subscription and sets state from it, so a resend or an
// out-of-order delivery converges to the truth. `accountId` is the connected account
// the event fired on.
export async function syncEnrollmentSubscription(accountId: string, subscriptionId: string): Promise<void> {
  const stripe = paymentsStripe()
  let subscription: StripeNS.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, undefined, { stripeAccount: accountId })
  } catch (error) {
    captureError(error, { scope: 'payments.enrollmentBilling.sync.retrieve' })
    return
  }

  const enrollmentId = subscription.metadata?.enrollmentId
  const organizationId = subscription.metadata?.organizationId
  if (!enrollmentId || !organizationId) {
    // Not one of ours (no enrolment metadata) — ignore.
    return
  }

  // The metadata naming the org is written by US at checkout, but it rides on an
  // object living on a connected account the SCHOOL controls — so it is attacker-
  // influenced input, not a trusted claim. Bind it to the account the event actually
  // fired on: a school can only ever move its own enrolments' billing state, never
  // another tenant's by naming them in metadata.
  const [owner] = await db
    .select({ stripeAccountId: orgPaymentAccount.stripeAccountId })
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  if (owner?.stripeAccountId !== accountId) {
    captureError(new Error('Subscription metadata org does not own the event account'), {
      scope: 'payments.enrollmentBilling.sync.accountMismatch',
      organizationId
    })
    return
  }

  const [row] = await db
    .select({ stripeSubscriptionId: enrollmentBilling.stripeSubscriptionId, status: enrollmentBilling.status })
    .from(enrollmentBilling)
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, enrollmentId)))
    .limit(1)
  if (!row) {
    // The billing row is created at checkout, so this shouldn't happen; ignore rather
    // than fabricate a row from an event we can't fully trust.
    return
  }

  // Double-subscription guard: if this enrolment is already billed by a DIFFERENT
  // active subscription, this one is a duplicate (e.g. two checkout links completed).
  // Cancel the duplicate and keep the first — never leave a family double-charged.
  if (row.status === 'active' && row.stripeSubscriptionId && row.stripeSubscriptionId !== subscriptionId) {
    await stripe.subscriptions.cancel(subscriptionId, undefined, { stripeAccount: accountId }).catch((error) => {
      captureError(error, { scope: 'payments.enrollmentBilling.sync.cancelDuplicate', organizationId })
    })
    return
  }

  const newStatus = mapStripeSubscriptionStatus(subscription.status)
  await db
    .update(enrollmentBilling)
    .set({
      status: newStatus,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: subscriptionPeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false
    })
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, enrollmentId)))

  // On the TRANSITION into past_due (a failed payment), alert school staff — once per
  // episode: a resend or retry while already past_due won't re-fire (old is past_due).
  // Best-effort — a notification failure never fails the webhook.
  if (row.status !== 'past_due' && newStatus === 'past_due') {
    await notifyPaymentFailed(organizationId, enrollmentId).catch((error) => {
      captureError(error, { scope: 'payments.enrollmentBilling.notifyPastDue', organizationId })
    })
  }
}

// ── Staff panel reads ───────────────────────────────────────────────────────

// The billing status of every enrolment in a series that has a billing row, keyed
// by enrolment id. Scoped by org via the enrolment join.
export async function listSeriesEnrollmentBilling(
  organizationId: string,
  seriesId: string
): Promise<Record<string, EnrollmentBillingSummary>> {
  const rows = await db
    .select({ enrollmentId: enrollmentBilling.enrollmentId, status: enrollmentBilling.status, cancelAtPeriodEnd: enrollmentBilling.cancelAtPeriodEnd, currentPeriodEnd: enrollmentBilling.currentPeriodEnd })
    .from(enrollmentBilling)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentBilling.enrollmentId))
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollment.seriesId, seriesId)))

  const map: Record<string, EnrollmentBillingSummary> = {}
  for (const row of rows) {
    map[row.enrollmentId] = {
      status: isEnrollmentBillingStatus(row.status) ? row.status : 'past_due',
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      currentPeriodEnd: row.currentPeriodEnd
    }
  }
  return map
}

// Whether/how the enrolment panel should show payment actions: the group's active
// plan (null = free group) + whether the connected account can actually charge.
export async function getSeriesBillingContext(
  organizationId: string,
  seriesId: string
): Promise<SeriesBillingContext> {
  const [series] = await db
    .select({ pricingPlanId: lessonSeries.pricingPlanId })
    .from(lessonSeries)
    .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, seriesId)))
    .limit(1)

  let plan: SeriesBillingContext['plan'] = null
  if (series?.pricingPlanId) {
    const [row] = await db
      .select({ id: pricingPlan.id, name: pricingPlan.name, amountMinor: pricingPlan.amountMinor, currency: pricingPlan.currency, archivedAt: pricingPlan.archivedAt })
      .from(pricingPlan)
      .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, series.pricingPlanId)))
      .limit(1)
    if (row && !row.archivedAt) {
      plan = { id: row.id, name: row.name, amountMinor: row.amountMinor, currency: row.currency }
    }
  }

  const [account] = await db
    .select({ chargesEnabled: orgPaymentAccount.chargesEnabled, payoutsEnabled: orgPaymentAccount.payoutsEnabled, detailsSubmitted: orgPaymentAccount.detailsSubmitted })
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  const paymentsReady = Boolean(account) && canCollectPayments(resolvePaymentAccountStatus({ hasAccount: true, ...account! }))

  return { plan, paymentsReady }
}

// A Stripe Customer Portal session for the payer of one enrolment — where they (or
// staff on their behalf) manage the card / cancel. On the connected account.
export async function createBillingPortalSession(
  organizationId: string,
  enrollmentId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const [row] = await db
    .select({ customerId: enrollmentBilling.stripeCustomerId })
    .from(enrollmentBilling)
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, enrollmentId)))
    .limit(1)
  if (!row?.customerId) {
    bad('No billing customer for this enrolment yet', 'BILLING_NO_CUSTOMER')
  }

  const [account] = await db
    .select({ stripeAccountId: orgPaymentAccount.stripeAccountId })
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  if (!account?.stripeAccountId) {
    bad('Payments are not set up', 'PAYMENTS_ACCOUNT_REQUIRED')
  }

  try {
    const session = await paymentsStripe().billingPortal.sessions.create(
      { customer: row.customerId, return_url: returnUrl },
      { stripeAccount: account.stripeAccountId }
    )
    return { url: session.url }
  } catch (error) {
    stripeFailed(error, organizationId, 'portal.create')
  }
}

// ── Staff money operations (cancel / refund) ────────────────────────────────

async function accountIdFor(organizationId: string): Promise<string> {
  const [account] = await db
    .select({ stripeAccountId: orgPaymentAccount.stripeAccountId })
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  if (!account?.stripeAccountId) {
    bad('Payments are not set up', 'PAYMENTS_ACCOUNT_REQUIRED')
  }
  return account.stripeAccountId
}

async function subscriptionFor(organizationId: string, enrollmentId: string): Promise<{ subscriptionId: string, status: string }> {
  const [row] = await db
    .select({ subscriptionId: enrollmentBilling.stripeSubscriptionId, status: enrollmentBilling.status })
    .from(enrollmentBilling)
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, enrollmentId)))
    .limit(1)
  if (!row?.subscriptionId) {
    bad('No active subscription for this enrolment', 'BILLING_NO_SUBSCRIPTION')
  }
  return { subscriptionId: row.subscriptionId, status: row.status }
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

// The Stripe object to refund — a payment intent (or, on older API shapes, a charge).
function refundTargetOf(invoice: StripeNS.Invoice): StripeNS.RefundCreateParams | null {
  const paymentIntent = idOf((invoice as unknown as { payment_intent?: unknown }).payment_intent)
  if (paymentIntent) {
    return { payment_intent: paymentIntent }
  }
  const charge = idOf((invoice as unknown as { charge?: unknown }).charge)
  if (charge) {
    return { charge }
  }
  return null
}

// Cancel a student's subscription. Default = at period end (they keep the spot until
// the paid month runs out — the humane default for a school); `immediately` stops it
// now. Then mirror the resulting state. Idempotent: cancelling an already-cancelled
// subscription is a no-op.
export async function cancelEnrollmentSubscription(
  organizationId: string,
  enrollmentId: string,
  options: { immediately?: boolean } = {},
  actor?: StaffActor
): Promise<EnrollmentBillingDto | null> {
  const { subscriptionId, status } = await subscriptionFor(organizationId, enrollmentId)
  if (status === 'canceled') {
    return getEnrollmentBilling(organizationId, enrollmentId)
  }

  const accountId = await accountIdFor(organizationId)
  const stripe = paymentsStripe()
  try {
    if (options.immediately) {
      await stripe.subscriptions.cancel(subscriptionId, undefined, { stripeAccount: accountId })
    } else {
      await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }, { stripeAccount: accountId })
    }
  } catch (error) {
    stripeFailed(error, organizationId, 'cancel')
  }

  await syncEnrollmentSubscription(accountId, subscriptionId)

  if (actor) {
    await recordPaymentAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorName: actor.name,
      action: 'subscription_canceled',
      enrollmentId,
      studentName: await studentNameFor(organizationId, enrollmentId),
      amountMinor: null,
      currency: null,
      stripeRef: subscriptionId
    })
  }

  return getEnrollmentBilling(organizationId, enrollmentId)
}

// Refund the latest payment on the enrolment's subscription (full refund). MONEY-OUT
// — owner-only at the handler. The **idempotency key is the invoice id**, so a retry
// or a double-click can never issue a second refund for the same charge (the single
// most important guard here). Stripe is the ledger; we record nothing locally.
export async function refundLatestPayment(
  organizationId: string,
  enrollmentId: string,
  actor?: StaffActor
): Promise<{ refunded: true }> {
  const { subscriptionId } = await subscriptionFor(organizationId, enrollmentId)
  const accountId = await accountIdFor(organizationId)
  const stripe = paymentsStripe()

  let subscription: StripeNS.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, undefined, { stripeAccount: accountId })
  } catch (error) {
    stripeFailed(error, organizationId, 'refund.retrieveSubscription')
  }

  const invoiceId = idOf((subscription as unknown as { latest_invoice?: unknown }).latest_invoice)
  if (!invoiceId) {
    bad('There is no payment to refund', 'BILLING_NOTHING_TO_REFUND')
  }

  let invoice: StripeNS.Invoice
  try {
    invoice = await stripe.invoices.retrieve(invoiceId, undefined, { stripeAccount: accountId })
  } catch (error) {
    stripeFailed(error, organizationId, 'refund.retrieveInvoice')
  }

  const target = refundTargetOf(invoice)
  if (!target) {
    bad('There is no payment to refund', 'BILLING_NOTHING_TO_REFUND')
  }

  let refund: StripeNS.Refund
  try {
    refund = await stripe.refunds.create(target, { stripeAccount: accountId, idempotencyKey: `refund-${invoiceId}` })
  } catch (error) {
    stripeFailed(error, organizationId, 'refund.create')
  }

  if (actor) {
    await recordPaymentAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorName: actor.name,
      action: 'refund_issued',
      enrollmentId,
      studentName: await studentNameFor(organizationId, enrollmentId),
      amountMinor: typeof refund.amount === 'number' ? refund.amount : null,
      currency: refund.currency ?? null,
      stripeRef: refund.id
    })
  }

  return { refunded: true }
}

// ── Lifecycle-driven billing stop ───────────────────────────────────────────

// The enrolment lifecycle's money counterpart. A spot that ENDS — the student was
// removed, left on their own, or the whole group was called off or deleted — must
// stop billing. Without this a family keeps paying every month for a group their
// child has left, and because the staff panel hides a cancelled enrolment (and a
// purge cascades the billing row away entirely) the charge becomes both invisible
// and unreachable from the app — recoverable only from the Stripe dashboard.
//
// Cancels AT PERIOD END: the month already paid for is honoured and no further
// charge is ever taken — the same humane default as the explicit staff cancel, and
// never a surprise refund (staff refund explicitly when they mean to). A Checkout
// link that was never completed is EXPIRED instead, so a stale email can't subscribe
// a payer to a spot that no longer exists.
//
// BEST-EFFORT and per-enrolment isolated — ending a spot must never fail because
// Stripe is unreachable — but never silent: failures are captured, and each stop is
// written to the money-audit trail, whose denormalized columns OUTLIVE the enrolment
// row, so even a purged group leaves the subscription id behind for reconciliation.
// Idempotent: a row already cancelled or already set to stop is skipped, so a
// double-cancel neither calls Stripe twice nor duplicates the trail.
export async function stopBillingForEnrollments(
  organizationId: string,
  enrollmentIds: string[],
  actor?: StaffActor
): Promise<void> {
  if (enrollmentIds.length === 0) {
    return
  }

  try {
    const rows = await db
      .select({
        enrollmentId: enrollmentBilling.enrollmentId,
        subscriptionId: enrollmentBilling.stripeSubscriptionId,
        checkoutSessionId: enrollmentBilling.checkoutSessionId
      })
      .from(enrollmentBilling)
      .where(and(
        eq(enrollmentBilling.organizationId, organizationId),
        inArray(enrollmentBilling.enrollmentId, enrollmentIds),
        ne(enrollmentBilling.status, 'canceled'),
        eq(enrollmentBilling.cancelAtPeriodEnd, false)
      ))
    if (rows.length === 0) {
      return
    }

    // A billing row can only exist once an account did — but read it softly rather
    // than throwing: this path must never turn a Stripe gap into a failed cancel.
    const [account] = await db
      .select({ stripeAccountId: orgPaymentAccount.stripeAccountId })
      .from(orgPaymentAccount)
      .where(eq(orgPaymentAccount.organizationId, organizationId))
      .limit(1)
    if (!account?.stripeAccountId) {
      return
    }

    for (const row of rows) {
      try {
        await stopOneEnrollmentBilling(organizationId, account.stripeAccountId, row, actor)
      } catch (error) {
        captureError(error, { scope: 'payments.enrollmentBilling.stop', organizationId })
      }
    }
  } catch (error) {
    captureError(error, { scope: 'payments.enrollmentBilling.stop', organizationId })
  }
}

async function stopOneEnrollmentBilling(
  organizationId: string,
  accountId: string,
  row: { enrollmentId: string, subscriptionId: string | null, checkoutSessionId: string | null },
  actor?: StaffActor
): Promise<void> {
  const stripe = paymentsStripe()

  if (row.subscriptionId) {
    await stripe.subscriptions.update(row.subscriptionId, { cancel_at_period_end: true }, { stripeAccount: accountId })
    await syncEnrollmentSubscription(accountId, row.subscriptionId)
    // Always recorded (not gated on an actor like the manual operations): this entry
    // is the durable trace of a real recurring charge being stopped, and the only one
    // that survives the enrolment row being purged.
    await recordPaymentAudit({
      organizationId,
      actorMemberId: actor?.memberId ?? null,
      actorName: actor?.name ?? null,
      action: 'subscription_canceled',
      enrollmentId: row.enrollmentId,
      studentName: await studentNameFor(organizationId, row.enrollmentId),
      amountMinor: null,
      currency: null,
      stripeRef: row.subscriptionId
    })
    return
  }

  // No subscription yet — only an unpaid Checkout link. Expire it so it can't turn
  // into a subscription for a spot that no longer exists. No money ever moved, so
  // there is nothing to record on the money trail.
  if (row.checkoutSessionId) {
    await stripe.checkout.sessions.expire(row.checkoutSessionId, undefined, { stripeAccount: accountId })
  }
  await db
    .update(enrollmentBilling)
    .set({ status: 'canceled' })
    .where(and(eq(enrollmentBilling.organizationId, organizationId), eq(enrollmentBilling.enrollmentId, row.enrollmentId)))
}

// Stop billing for every spot in a group — the whole-group counterpart, used when a
// series is cancelled or deleted. Kept here so the schedule service never needs to
// know how enrolment billing is stored.
export async function stopBillingForSeries(
  organizationId: string,
  seriesId: string,
  actor?: StaffActor
): Promise<void> {
  try {
    const rows = await db
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.seriesId, seriesId)))
    await stopBillingForEnrollments(organizationId, rows.map(row => row.id), actor)
  } catch (error) {
    captureError(error, { scope: 'payments.enrollmentBilling.stopSeries', organizationId })
  }
}
