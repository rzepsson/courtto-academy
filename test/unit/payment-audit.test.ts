import { describe, expect, it } from 'vitest'
import { PAYMENT_AUDIT_ACTIONS, isPaymentAuditAction } from '../../shared/payment-audit'

describe('payment audit actions', () => {
  it('recognises the money-movement actions', () => {
    for (const action of ['checkout_sent', 'subscription_canceled', 'refund_issued']) {
      expect(isPaymentAuditAction(action)).toBe(true)
      expect((PAYMENT_AUDIT_ACTIONS as readonly string[]).includes(action)).toBe(true)
    }
  })

  it('rejects unknown actions (so a stray value never renders as a money event)', () => {
    expect(isPaymentAuditAction('deleted_everything')).toBe(false)
    expect(isPaymentAuditAction('')).toBe(false)
  })
})
