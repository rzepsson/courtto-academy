import type StripeNS from 'stripe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { orgPaymentAccount } from '../../database/app-schema'
import type { OrgPaymentAccountRow, PaymentAccountDto } from '../../database/types'
import { resolvePaymentAccountStatus } from '../../../shared/payments'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import { isPaymentsConfigured, paymentsStripe } from '../payments-config'
import { captureError } from '../monitoring'
import { getOrgProfile } from './orgProfile'

// Payment-account service — CORE (Stripe Connect plumbing). Owns the local MIRROR
// of the school's connected-account state; Stripe is the source of truth (kept
// fresh by the Connect webhook + an on-demand sync). Every read/write is scoped by
// organizationId (or by the unique stripeAccountId, which the webhook carries).

async function readAccount(organizationId: string): Promise<OrgPaymentAccountRow | null> {
  const [row] = await db
    .select()
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  return row ?? null
}

function toDto(row: OrgPaymentAccountRow | null): PaymentAccountDto {
  const hasAccount = Boolean(row?.stripeAccountId)
  const chargesEnabled = row?.chargesEnabled ?? false
  const payoutsEnabled = row?.payoutsEnabled ?? false
  const detailsSubmitted = row?.detailsSubmitted ?? false
  return {
    status: resolvePaymentAccountStatus(hasAccount ? { hasAccount, chargesEnabled, payoutsEnabled, detailsSubmitted } : null),
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    configured: isPaymentsConfigured()
  }
}

// Mirror the enabled/submitted flags from a Stripe account object. Scoped by the
// stripe account id — the webhook only knows the account, not the org.
async function persistFlags(account: StripeNS.Account): Promise<void> {
  await db
    .update(orgPaymentAccount)
    .set({
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false
    })
    .where(eq(orgPaymentAccount.stripeAccountId, account.id))
}

// Refresh the mirror from Stripe for one connected account. The Connect webhook
// (account.updated) calls this; so does an on-demand read.
export async function syncAccountFromStripe(accountId: string): Promise<void> {
  const account = await paymentsStripe().accounts.retrieve(accountId)
  await persistFlags(account)
}

// The school's payment-collection status. Refreshes the mirror from Stripe first
// when an account exists (authoritative + fresh right after onboarding, before the
// webhook lands); best-effort — a Stripe hiccup degrades to the stored mirror.
export async function getPaymentAccount(organizationId: string): Promise<PaymentAccountDto> {
  const row = await readAccount(organizationId)
  if (row?.stripeAccountId) {
    try {
      await syncAccountFromStripe(row.stripeAccountId)
      return toDto(await readAccount(organizationId))
    } catch (error) {
      captureError(error, { scope: 'payments.getPaymentAccount', organizationId })
    }
  }
  return toDto(row)
}

// Idempotently get-or-create the org's Express connected account and return a fresh
// Stripe-hosted onboarding link. Owner-gated at the handler. Idempotency is
// double-guarded: the durable DB row (one account per org) + a Stripe idempotency
// key (same-day retries return the same account, never a second one).
export async function startOnboarding(
  organizationId: string,
  urls: { returnUrl: string, refreshUrl: string }
): Promise<{ url: string }> {
  const stripe = paymentsStripe()
  let row = await readAccount(organizationId)

  if (!row?.stripeAccountId) {
    const profile = await getOrgProfile(organizationId)
    const account = await stripe.accounts.create({
      type: 'express',
      country: profile.country || REGIONAL_FALLBACK.country,
      email: profile.contactEmail ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      }
    }, {
      idempotencyKey: `connect-account-${organizationId}`
    })

    await db
      .insert(orgPaymentAccount)
      .values({
        organizationId,
        stripeAccountId: account.id,
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
        detailsSubmitted: account.details_submitted ?? false
      })
      .onConflictDoNothing({ target: orgPaymentAccount.organizationId })

    row = await readAccount(organizationId)
  }

  const link = await stripe.accountLinks.create({
    account: row!.stripeAccountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: 'account_onboarding'
  })

  return { url: link.url }
}
