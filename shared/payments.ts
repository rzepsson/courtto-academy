// Lesson-fee payments domain — PURE, no Nuxt/Node imports (the shared/ rule).
// CORE, product-neutral plumbing: the future Courtto marketplace collects court-
// booking fees through the exact same Stripe Connect account, so nothing here
// references lessons. This is the "parent → school" money flow (school = merchant),
// distinct from the "school → Courtto" subscription in shared/billing.ts.
//
// Readiness is DERIVED from the connected account's flags, never stored as a
// separate boolean that would drift from Stripe (the same discipline as the
// subscription entitlement).

export interface PaymentAccountFlags {
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

// none      — the school has never started Connect onboarding.
// pending   — an account exists but can't charge yet (onboarding unfinished, or
//             Stripe is still verifying / needs more information).
// ready     — the account can accept charges: onboarding done AND charges enabled.
export type PaymentAccountStatus = 'none' | 'pending' | 'ready'

export function resolvePaymentAccountStatus(
  account: (PaymentAccountFlags & { hasAccount: boolean }) | null
): PaymentAccountStatus {
  if (!account || !account.hasAccount) {
    return 'none'
  }
  // Both must hold: `details_submitted` alone can be true while Stripe still has the
  // account restricted (charges disabled) pending verification — so we never call a
  // school "ready" to take a parent's money until Stripe says charges are enabled.
  if (account.chargesEnabled && account.detailsSubmitted) {
    return 'ready'
  }
  return 'pending'
}

// The single question the app asks before letting a school collect fees. Fail-safe:
// anything short of an explicit `ready` blocks collection (mirrors mayUse / entitled).
export function canCollectPayments(status: PaymentAccountStatus): boolean {
  return status === 'ready'
}
