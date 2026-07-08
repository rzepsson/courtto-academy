import { describe, expect, it } from 'vitest'
import { normalizeError, resolveErrorKey } from '../../app/utils/errors'

describe('normalizeError', () => {
  it('returns empty fields for non-object input', () => {
    expect(normalizeError(null)).toEqual({ code: null, status: undefined })
    expect(normalizeError(undefined)).toEqual({ code: null, status: undefined })
    expect(normalizeError('boom')).toEqual({ code: null, status: undefined })
  })

  it('reads a Better Auth error shape ({ code, status })', () => {
    expect(normalizeError({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      status: 401
    })
  })

  it('reads an ofetch FetchError shape ({ statusCode, data.code })', () => {
    expect(normalizeError({ statusCode: 403, data: { code: 'MEMBER_NOT_FOUND' } })).toEqual({
      code: 'MEMBER_NOT_FOUND',
      status: 403
    })
  })

  it('prefers a top-level code over a nested data.code', () => {
    expect(normalizeError({ code: 'TOP', data: { code: 'NESTED' } }).code).toBe('TOP')
  })

  it('ignores empty-string and non-numeric fields', () => {
    expect(normalizeError({ code: '', status: '401' })).toEqual({ code: null, status: undefined })
  })
})

describe('resolveErrorKey', () => {
  const known = (key: string) => key === 'error.codes.INVALID_EMAIL_OR_PASSWORD'

  it('maps a known code to its error.codes.* key', () => {
    expect(resolveErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 }, known))
      .toBe('error.codes.INVALID_EMAIL_OR_PASSWORD')
  })

  it('falls back to generic copy for an unknown code', () => {
    expect(resolveErrorKey({ code: 'SOMETHING_NEW', status: 400 }, known))
      .toBe('error.generic.description')
  })

  it('maps a 429 with no known code to the rate-limit message', () => {
    expect(resolveErrorKey({ status: 429 }, known)).toBe('error.rateLimited')
  })

  it('maps a status-0 network failure to the network message', () => {
    expect(resolveErrorKey({ status: 0 }, known)).toBe('error.network')
  })

  it('falls back to generic copy when nothing matches', () => {
    expect(resolveErrorKey(null, known)).toBe('error.generic.description')
  })

  it('prioritizes a known code over a status fallback', () => {
    expect(resolveErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 429 }, known))
      .toBe('error.codes.INVALID_EMAIL_OR_PASSWORD')
  })
})
