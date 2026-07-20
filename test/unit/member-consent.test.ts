import { describe, expect, it } from 'vitest'
import {
  CONSENT_TYPES,
  consentState,
  isConsentDecision,
  isConsentType,
  mayUse
} from '../../shared/member-consent'
import { consentDecisionSchema } from '../../shared/member-consent-schema'

const raw = (code: string) => code
const schema = consentDecisionSchema(raw)

describe('consent types', () => {
  it('covers only genuinely consent-based purposes', () => {
    expect([...CONSENT_TYPES]).toEqual(['image', 'marketing'])
  })

  it('deliberately has no “data processing” consent — that basis is the contract', () => {
    // Modelling it as consent would make it withdrawable (art. 7(3)), which would
    // have to stop the service. Guard the omission so nobody "helpfully" adds it.
    expect(isConsentType('data_processing')).toBe(false)
  })

  it('guards unknown types', () => {
    expect(isConsentType('image')).toBe(true)
    expect(isConsentType('whatever')).toBe(false)
  })
})

describe('consentState', () => {
  it('treats “no record” as unknown, never as withdrawn', () => {
    // The distinction is the whole point: unknown = paperwork to chase,
    // withdrawn = a decision to respect.
    expect(consentState(null)).toBe('unknown')
    expect(consentState(undefined)).toBe('unknown')
  })

  it('reads the stored decision', () => {
    expect(consentState({ status: 'granted' })).toBe('granted')
    expect(consentState({ status: 'withdrawn' })).toBe('withdrawn')
  })

  it('degrades an unrecognised stored value to unknown, never to granted', () => {
    // Failing open on a corrupt row would mean processing without consent.
    expect(consentState({ status: 'garbage' })).toBe('unknown')
  })
})

describe('mayUse', () => {
  it('permits only an explicit grant — silence is never permission', () => {
    expect(mayUse('granted')).toBe(true)
    expect(mayUse('withdrawn')).toBe(false)
    expect(mayUse('unknown')).toBe(false)
  })
})

describe('isConsentDecision', () => {
  it('accepts only the two storable decisions', () => {
    expect(isConsentDecision('granted')).toBe(true)
    expect(isConsentDecision('withdrawn')).toBe(true)
    // `unknown` is a derived display state, never something you can record.
    expect(isConsentDecision('unknown')).toBe(false)
  })
})

describe('consentDecisionSchema', () => {
  it('accepts a decision and normalizes empty optionals to null', () => {
    expect(schema.parse({ status: 'granted', documentVersion: '  ', notes: '' }))
      .toMatchObject({ status: 'granted', documentVersion: null, notes: null })
  })

  it('rejects a decision it cannot store', () => {
    expect(schema.safeParse({ status: 'maybe', documentVersion: '', notes: '' }).success).toBe(false)
  })

  it('does not require a guardian — that rule depends on age, which the service owns', () => {
    expect(schema.safeParse({ status: 'granted', documentVersion: '', notes: '' }).success).toBe(true)
  })
})
