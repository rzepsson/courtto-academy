import { describe, expect, it } from 'vitest'
import { ENROLLMENT_BILLING_STATUSES, isEnrollmentBillingStatus, mapStripeSubscriptionStatus } from '../../shared/enrollment-billing'

describe('mapStripeSubscriptionStatus', () => {
  it('treats active and trialing as active', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active')
    expect(mapStripeSubscriptionStatus('trialing')).toBe('active')
  })

  it('treats a payment problem as past_due (needs attention, recoverable)', () => {
    for (const status of ['past_due', 'unpaid', 'incomplete', 'paused']) {
      expect(mapStripeSubscriptionStatus(status)).toBe('past_due')
    }
  })

  it('treats a real cancellation as canceled', () => {
    expect(mapStripeSubscriptionStatus('canceled')).toBe('canceled')
    expect(mapStripeSubscriptionStatus('incomplete_expired')).toBe('canceled')
  })

  it('fails safe: an unknown status is never optimistically active', () => {
    const mapped = mapStripeSubscriptionStatus('some_future_status')
    expect(mapped).toBe('past_due')
    expect(mapped).not.toBe('active')
  })

  it('isEnrollmentBillingStatus guards the enum', () => {
    for (const status of ENROLLMENT_BILLING_STATUSES) {
      expect(isEnrollmentBillingStatus(status)).toBe(true)
    }
    expect(isEnrollmentBillingStatus('nonsense')).toBe(false)
  })
})
