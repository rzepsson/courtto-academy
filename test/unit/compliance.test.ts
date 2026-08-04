import { describe, expect, it } from 'vitest'
import { evaluateCompliance, hasComplianceGap } from '../../shared/compliance'

// A fixed "now" so age-derived minority is deterministic.
const NOW = new Date('2026-07-21T12:00:00.000Z')
const minorDob = '2012-01-01' // 14 on NOW
const adultDob = '1990-01-01' // 36 on NOW

describe('evaluateCompliance — guardian gap', () => {
  it('flags a minor with no guardians', () => {
    const gaps = evaluateCompliance({ dateOfBirth: minorDob, guardianCount: 0, imageConsentStatus: 'granted' }, NOW)
    expect(gaps.missingGuardian).toBe(true)
  })

  it('clears once the minor has a guardian', () => {
    const gaps = evaluateCompliance({ dateOfBirth: minorDob, guardianCount: 1, imageConsentStatus: 'granted' }, NOW)
    expect(gaps.missingGuardian).toBe(false)
  })

  it('never flags an adult, guardians or not', () => {
    expect(evaluateCompliance({ dateOfBirth: adultDob, guardianCount: 0, imageConsentStatus: 'granted' }, NOW).missingGuardian).toBe(false)
  })

  it('never flags a member with an unknown date of birth (can\'t establish minority)', () => {
    expect(evaluateCompliance({ dateOfBirth: null, guardianCount: 0, imageConsentStatus: 'granted' }, NOW).missingGuardian).toBe(false)
  })
})

describe('evaluateCompliance — image consent gap', () => {
  it('flags a member never asked (no consent row → unknown)', () => {
    const gaps = evaluateCompliance({ dateOfBirth: adultDob, guardianCount: 0, imageConsentStatus: null }, NOW)
    expect(gaps.missingImageConsent).toBe(true)
  })

  it('clears once image consent is granted', () => {
    expect(evaluateCompliance({ dateOfBirth: adultDob, guardianCount: 0, imageConsentStatus: 'granted' }, NOW).missingImageConsent).toBe(false)
  })

  it('does NOT flag a withdrawn consent — a respected decision is not a chase-able gap', () => {
    // The doctrine-critical case: withdrawn must never be surfaced as "missing",
    // or the report would nudge staff to re-ask a decision they must respect.
    expect(evaluateCompliance({ dateOfBirth: adultDob, guardianCount: 0, imageConsentStatus: 'withdrawn' }, NOW).missingImageConsent).toBe(false)
  })

  it('degrades an unrecognized stored status to unknown (fail toward chasing, never toward "used it")', () => {
    expect(evaluateCompliance({ dateOfBirth: adultDob, guardianCount: 0, imageConsentStatus: 'garbage' }, NOW).missingImageConsent).toBe(true)
  })
})

describe('hasComplianceGap', () => {
  it('is true when either gap is present, false when clean', () => {
    expect(hasComplianceGap({ missingGuardian: false, missingImageConsent: false })).toBe(false)
    expect(hasComplianceGap({ missingGuardian: true, missingImageConsent: false })).toBe(true)
    expect(hasComplianceGap({ missingGuardian: false, missingImageConsent: true })).toBe(true)
  })
})
