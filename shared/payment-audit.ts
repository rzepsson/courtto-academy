// Money-movement audit vocabulary — the stable action keys for the internal,
// append-only trail of staff payment operations (who sent a link / cancelled /
// refunded). PURE, no Nuxt/Node imports. This is the INTERNAL accountability trail;
// Stripe remains the authoritative money ledger. The client renders these keys to
// localized copy (rule 5), so the strings here are never user-facing.

export const PAYMENT_AUDIT_ACTIONS = ['checkout_sent', 'subscription_canceled', 'refund_issued'] as const
export type PaymentAuditAction = (typeof PAYMENT_AUDIT_ACTIONS)[number]

export function isPaymentAuditAction(value: string): value is PaymentAuditAction {
  return (PAYMENT_AUDIT_ACTIONS as readonly string[]).includes(value)
}
