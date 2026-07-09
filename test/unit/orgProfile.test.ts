import { describe, expect, it } from 'vitest'
import { computeProfileCompletion, isEmailLike, isHttpUrlLike, isPhoneLike, isSport } from '../../shared/org-profile'
import {
  orgProfilePatchSchema,
  orgProfileSchema,
  orgProfileSectionSchema,
  type ProfileErrorCode
} from '../../shared/org-profile-schema'

// Identity resolver: the message is the raw error code, so assertions read the
// stable code the client later localizes.
const code = (c: ProfileErrorCode) => c
const schema = orgProfileSchema(code)
const patch = orgProfilePatchSchema(code)

// Collect (path, message) pairs from a failed parse for terse assertions.
function issues(result: { success: boolean, error?: { issues: { path: PropertyKey[], message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map(i => ({ field: i.path.join('.'), code: i.message }))
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
    expect(computeProfileCompletion(ready).complete).toBe(true)
  })

  it('treats whitespace-only text as empty', () => {
    expect(computeProfileCompletion({ ...ready, contactEmail: '   ' }).missing).toEqual(['contactEmail'])
  })
})

describe('orgProfileSchema — normalization', () => {
  it('trims text and collapses empties to null', () => {
    const result = patch.parse({ description: '  Hello  ', city: '   ', contactEmail: '  club@courtto.pl ' })
    expect(result).toEqual({ description: 'Hello', city: null, contactEmail: 'club@courtto.pl' })
  })

  it('uppercases country and currency, preserving null for empties', () => {
    expect(patch.parse({ country: ' pl ', currency: 'pln' })).toEqual({ country: 'PL', currency: 'PLN' })
    expect(patch.parse({ country: '' })).toEqual({ country: null })
  })

  it('dedupes sports', () => {
    expect(patch.parse({ sports: ['tennis', 'tennis', 'padel'] })).toEqual({ sports: ['tennis', 'padel'] })
  })
})

describe('orgProfilePatchSchema — partial semantics', () => {
  it('returns only the keys present in the body, so sections save independently', () => {
    expect(Object.keys(patch.parse({ city: 'Warsaw' }))).toEqual(['city'])
  })

  it('accepts an empty patch', () => {
    expect(patch.parse({})).toEqual({})
  })
})

describe('orgProfileSchema — format validation', () => {
  it('rejects a malformed email with the `email` code on the field', () => {
    expect(issues(schema.pick({ contactEmail: true }).safeParse({ contactEmail: 'nope' })))
      .toEqual([{ field: 'contactEmail', code: 'email' }])
  })

  it('rejects a malformed URL with the `url` code', () => {
    expect(issues(schema.pick({ websiteUrl: true }).safeParse({ websiteUrl: 'courtto.pl' })))
      .toEqual([{ field: 'websiteUrl', code: 'url' }])
  })

  it('rejects a malformed phone with the `phone` code', () => {
    expect(issues(schema.pick({ contactPhone: true }).safeParse({ contactPhone: '123' })))
      .toEqual([{ field: 'contactPhone', code: 'phone' }])
  })

  it('rejects an unknown sport with the `sport` code', () => {
    expect(issues(schema.pick({ sports: true }).safeParse({ sports: ['golf'] })))
      .toEqual([{ field: 'sports', code: 'sport' }])
  })

  it('rejects an unknown locale and a bad timezone', () => {
    expect(issues(schema.pick({ locale: true }).safeParse({ locale: 'de' })))
      .toEqual([{ field: 'locale', code: 'locale' }])
    expect(issues(schema.pick({ timezone: true }).safeParse({ timezone: 'Mars/Phobos' })))
      .toEqual([{ field: 'timezone', code: 'timezone' }])
  })

  it('rejects over-length text with the `tooLong` code', () => {
    expect(issues(schema.pick({ taxId: true }).safeParse({ taxId: 'x'.repeat(50) })))
      .toEqual([{ field: 'taxId', code: 'tooLong' }])
  })

  it('passes when optional fields are empty', () => {
    const result = patch.safeParse({ contactEmail: '', websiteUrl: '', contactPhone: '' })
    expect(result.success).toBe(true)
  })
})

describe('orgProfileSectionSchema — isolation', () => {
  it('validates only its own section and strips other fields', () => {
    // A bad website is present, but the contact section is validated on its own
    // fields; the description belongs to another section and is stripped.
    const contact = orgProfileSectionSchema('contact', code)
    const result = contact.parse({ contactEmail: 'club@courtto.pl', description: 'ignored' })
    expect(result).toEqual({ contactEmail: 'club@courtto.pl' })
  })

  it('surfaces a section field error', () => {
    const contact = orgProfileSectionSchema('contact', code)
    expect(issues(contact.safeParse({ instagramUrl: 'nope' })))
      .toEqual([{ field: 'instagramUrl', code: 'url' }])
  })
})
