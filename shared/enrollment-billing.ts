// Enrollment billing (ACADEMY) — the state of a student's paid spot in a group,
// mirrored from a Stripe subscription on the school's connected account. PURE, no
// Nuxt/Node imports. Webhooks are the source of truth; this module only maps
// Stripe's status vocabulary to ours and never decides money.

export const ENROLLMENT_BILLING_STATUSES = ['pending_payment', 'active', 'past_due', 'canceled'] as const
export type EnrollmentBillingStatus = (typeof ENROLLMENT_BILLING_STATUSES)[number]

export function isEnrollmentBillingStatus(value: string): value is EnrollmentBillingStatus {
  return (ENROLLMENT_BILLING_STATUSES as readonly string[]).includes(value)
}

// Map a Stripe subscription status to our billing status. FAIL-SAFE: anything not
// clearly `active`/`trialing` is treated as needing attention (`past_due`) or ended
// (`canceled`) — NEVER optimistically active. Access is deliberately NOT gated on
// this (the locked policy: a lapsed payment flags the spot, staff decides), so it
// drives display + alerts, not entry.
export function mapStripeSubscriptionStatus(status: string): EnrollmentBillingStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    // past_due | unpaid | incomplete | paused | anything unknown → needs attention.
    default:
      return 'past_due'
  }
}
