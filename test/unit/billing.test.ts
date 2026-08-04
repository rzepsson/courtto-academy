import { describe, expect, it } from 'vitest'
import {
  BILLING_PLANS,
  PLAN_IDS,
  TRIAL_DAYS,
  isPlanId,
  planById,
  resolveEntitlement
} from '../../shared/billing'
import type { SubscriptionSnapshot } from '../../shared/billing'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-21T12:00:00.000Z')

function sub(overrides: Partial<SubscriptionSnapshot>): SubscriptionSnapshot {
  return {
    plan: 'pro',
    status: 'active',
    periodEnd: new Date(NOW.getTime() + 20 * DAY),
    trialEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides
  }
}

describe('plan catalog', () => {
  it('catalog ids match PLAN_IDS and are unique', () => {
    expect(BILLING_PLANS.map(p => p.id)).toEqual([...PLAN_IDS])
    expect(new Set(BILLING_PLANS.map(p => p.id)).size).toBe(BILLING_PLANS.length)
  })

  it('isPlanId / planById reject unknown values without throwing', () => {
    expect(isPlanId('pro')).toBe(true)
    expect(isPlanId('enterprise')).toBe(false)
    expect(isPlanId(null)).toBe(false)
    expect(planById('starter')?.id).toBe('starter')
    expect(planById('nope')).toBeNull()
    expect(planById(undefined)).toBeNull()
  })
})

describe('resolveEntitlement — no subscription (app-managed trial)', () => {
  it('grants a trial within the window and counts whole days left (ceil)', () => {
    const createdAt = new Date(NOW.getTime() - 3 * DAY)
    const e = resolveEntitlement(null, createdAt, NOW)
    expect(e.status).toBe('trialing')
    expect(e.entitled).toBe(true)
    expect(e.planId).toBeNull()
    expect(e.trialDaysLeft).toBe(TRIAL_DAYS - 3)
    expect(e.trialEndsAt).toEqual(new Date(createdAt.getTime() + TRIAL_DAYS * DAY))
  })

  it('blocks once the trial window has elapsed', () => {
    const createdAt = new Date(NOW.getTime() - (TRIAL_DAYS + 1) * DAY)
    const e = resolveEntitlement(null, createdAt, NOW)
    expect(e.status).toBe('none')
    expect(e.entitled).toBe(false)
    expect(e.trialDaysLeft).toBe(0)
  })

  it('blocks exactly at the boundary (trial end is exclusive)', () => {
    const createdAt = new Date(NOW.getTime() - TRIAL_DAYS * DAY)
    const e = resolveEntitlement(null, createdAt, NOW)
    expect(e.entitled).toBe(false)
    expect(e.status).toBe('none')
  })
})

describe('resolveEntitlement — with a subscription', () => {
  it('active + future period → entitled', () => {
    const e = resolveEntitlement(sub({ status: 'active' }), NOW, NOW)
    expect(e.status).toBe('active')
    expect(e.entitled).toBe(true)
    expect(e.planId).toBe('pro')
    expect(e.trialEndsAt).toBeNull()
  })

  it('Stripe trialing + future trial end → entitled trialing (not the app trial)', () => {
    const e = resolveEntitlement(
      sub({ status: 'trialing', periodEnd: null, trialEnd: new Date(NOW.getTime() + 5 * DAY) }),
      NOW,
      NOW
    )
    expect(e.status).toBe('trialing')
    expect(e.entitled).toBe(true)
    // App-trial fields stay null once a real subscription exists.
    expect(e.trialEndsAt).toBeNull()
    expect(e.trialDaysLeft).toBeNull()
  })

  it('cancel-at-period-end but still within the paid period → still entitled', () => {
    const e = resolveEntitlement(sub({ status: 'active', cancelAtPeriodEnd: true }), NOW, NOW)
    expect(e.entitled).toBe(true)
    expect(e.status).toBe('active')
  })

  it('past_due → blocked, distinct status (recoverable via portal)', () => {
    const e = resolveEntitlement(sub({ status: 'past_due' }), NOW, NOW)
    expect(e.status).toBe('past_due')
    expect(e.entitled).toBe(false)
    expect(e.planId).toBe('pro')
  })

  it('canceled → blocked', () => {
    const e = resolveEntitlement(sub({ status: 'canceled' }), NOW, NOW)
    expect(e.status).toBe('canceled')
    expect(e.entitled).toBe(false)
  })

  it('defensive: active status but the period already ended (missed webhook) → blocked', () => {
    const e = resolveEntitlement(
      sub({ status: 'active', periodEnd: new Date(NOW.getTime() - DAY) }),
      NOW,
      NOW
    )
    expect(e.entitled).toBe(false)
    expect(e.status).toBe('canceled')
  })

  it('fail-safe: an unknown Stripe status never grants access', () => {
    const e = resolveEntitlement(sub({ status: 'paused' }), NOW, NOW)
    expect(e.entitled).toBe(false)
    expect(e.status).toBe('canceled')
  })

  it('an unrecognized plan still resolves entitlement, with a null planId', () => {
    const e = resolveEntitlement(sub({ status: 'active', plan: 'legacy_tier' }), NOW, NOW)
    expect(e.entitled).toBe(true)
    expect(e.planId).toBeNull()
  })
})
