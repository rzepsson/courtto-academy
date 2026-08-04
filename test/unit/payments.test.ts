import { describe, expect, it } from 'vitest'
import { canCollectPayments, resolvePaymentAccountStatus } from '../../shared/payments'

const flags = (over: Partial<{ chargesEnabled: boolean, payoutsEnabled: boolean, detailsSubmitted: boolean }> = {}) => ({
  hasAccount: true,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  ...over
})

describe('resolvePaymentAccountStatus', () => {
  it('is none with no account at all', () => {
    expect(resolvePaymentAccountStatus(null)).toBe('none')
    expect(resolvePaymentAccountStatus({ ...flags(), hasAccount: false })).toBe('none')
  })

  it('is pending while onboarding is unfinished (details not submitted)', () => {
    expect(resolvePaymentAccountStatus(flags({ detailsSubmitted: false, chargesEnabled: false }))).toBe('pending')
  })

  it('stays pending when details are submitted but Stripe has not enabled charges (restricted / under review)', () => {
    // The safety case: details_submitted alone must never read as "ready" — Stripe
    // can still hold the account restricted while it verifies.
    expect(resolvePaymentAccountStatus(flags({ detailsSubmitted: true, chargesEnabled: false }))).toBe('pending')
  })

  it('is ready only when charges are enabled AND details submitted', () => {
    expect(resolvePaymentAccountStatus(flags({ detailsSubmitted: true, chargesEnabled: true }))).toBe('ready')
  })
})

describe('canCollectPayments', () => {
  it('permits collection only in the ready state (fail-safe otherwise)', () => {
    expect(canCollectPayments('ready')).toBe(true)
    expect(canCollectPayments('pending')).toBe(false)
    expect(canCollectPayments('none')).toBe(false)
  })
})
