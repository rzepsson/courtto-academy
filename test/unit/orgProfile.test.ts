import { describe, expect, it } from 'vitest'
import { computeProfileCompletion, isEmailLike, isHttpUrlLike, isPhoneLike, isSport } from '../../shared/org-profile'
import { validateProfileFields, type ProfileFormState } from '../../app/utils/orgProfile'

const t = (key: string) => key

function blank(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
  return {
    description: '',
    sports: [],
    contactEmail: '',
    contactPhone: '',
    websiteUrl: '',
    instagramUrl: '',
    facebookUrl: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    postalCode: '',
    country: '',
    timezone: '',
    locale: '',
    currency: '',
    legalName: '',
    taxId: '',
    ...overrides
  }
}

describe('isEmailLike', () => {
  it('accepts plausible emails', () => {
    expect(isEmailLike('club@courtto.pl')).toBe(true)
    expect(isEmailLike('a.b+tag@sub.example.co.uk')).toBe(true)
  })
  it('rejects malformed emails', () => {
    expect(isEmailLike('nope')).toBe(false)
    expect(isEmailLike('a@b')).toBe(false)
    expect(isEmailLike('a b@c.pl')).toBe(false)
  })
})

describe('isHttpUrlLike', () => {
  it('accepts http(s) URLs', () => {
    expect(isHttpUrlLike('https://courtto.pl')).toBe(true)
    expect(isHttpUrlLike('http://a.b/c?d=1')).toBe(true)
  })
  it('rejects non-http URLs and garbage', () => {
    expect(isHttpUrlLike('ftp://a.b')).toBe(false)
    expect(isHttpUrlLike('courtto.pl')).toBe(false)
    expect(isHttpUrlLike('javascript:alert(1)')).toBe(false)
  })
})

describe('isPhoneLike', () => {
  it('accepts real-world phone formats', () => {
    expect(isPhoneLike('+48 123 456 789')).toBe(true)
    expect(isPhoneLike('(22) 123-45-67')).toBe(true)
  })
  it('rejects too short or non-numeric input', () => {
    expect(isPhoneLike('12345')).toBe(false)
    expect(isPhoneLike('call me')).toBe(false)
  })
})

describe('isSport', () => {
  it('accepts known sports and rejects others', () => {
    expect(isSport('tennis')).toBe(true)
    expect(isSport('padel')).toBe(true)
    expect(isSport('golf')).toBe(false)
  })
})

describe('computeProfileCompletion', () => {
  const ready = {
    contactEmail: 'club@courtto.pl',
    sports: ['tennis'],
    city: 'Warsaw',
    country: 'PL'
  }

  it('is complete when every required field is filled', () => {
    expect(computeProfileCompletion(ready)).toEqual({ complete: true, missing: [] })
  })

  it('flags each missing required field', () => {
    const result = computeProfileCompletion({ contactEmail: null, sports: [], city: '  ', country: null })
    expect(result.complete).toBe(false)
    expect(result.missing).toEqual(['contactEmail', 'sports', 'city', 'country'])
  })

  it('treats an empty sports array as missing but a non-empty one as present', () => {
    expect(computeProfileCompletion({ ...ready, sports: [] }).missing).toEqual(['sports'])
    expect(computeProfileCompletion({ ...ready, sports: ['padel'] }).complete).toBe(true)
  })

  it('ignores operational fields with safe defaults (timezone/locale/currency)', () => {
    // Only the four required fields matter; nothing else can block readiness.
    expect(computeProfileCompletion(ready).complete).toBe(true)
  })

  it('treats whitespace-only text as empty', () => {
    expect(computeProfileCompletion({ ...ready, contactEmail: '   ' }).missing).toEqual(['contactEmail'])
  })
})

describe('validateProfileFields', () => {
  it('passes when optional fields are empty', () => {
    expect(validateProfileFields(['contactEmail', 'websiteUrl'], blank(), t)).toEqual([])
  })

  it('flags a malformed email in the section', () => {
    const errors = validateProfileFields(['contactEmail'], blank({ contactEmail: 'nope' }), t)
    expect(errors).toEqual([{ name: 'contactEmail', message: 'school.settings.errors.email' }])
  })

  it('only validates the requested fields', () => {
    // A bad website is present but the Contact section (email/phone) is clean.
    const state = blank({ websiteUrl: 'not-a-url', contactEmail: 'club@courtto.pl' })
    expect(validateProfileFields(['contactEmail', 'contactPhone'], state, t)).toEqual([])
  })

  it('validates multiple URL fields', () => {
    const state = blank({ instagramUrl: 'nope', facebookUrl: 'https://fb.com/club' })
    const errors = validateProfileFields(['instagramUrl', 'facebookUrl'], state, t)
    expect(errors).toEqual([{ name: 'instagramUrl', message: 'school.settings.errors.url' }])
  })

  it('ignores fields that have no validator (free text)', () => {
    expect(validateProfileFields(['description', 'city'], blank({ description: 'x', city: 'y' }), t)).toEqual([])
  })
})
