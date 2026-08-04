import { describe, expect, it } from 'vitest'
import { describeUserAgent, formatDeviceLabel, MIN_PASSWORD_LENGTH, accountFormSchemas } from '../../app/utils/account'

// User agents are matched by the more specific token first — every Chromium
// browser also claims Chrome and Safari, and every Android also claims Linux.
describe('describeUserAgent', () => {
  it('identifies Chrome on Windows', () => {
    expect(describeUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    )).toEqual({ browser: 'Chrome', os: 'Windows' })
  })

  it('prefers Edge over the Chrome token it also carries', () => {
    expect(describeUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
    ).browser).toBe('Edge')
  })

  it('prefers Firefox over the Safari token in its iOS build', () => {
    expect(describeUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15'
    )).toEqual({ browser: 'Firefox', os: 'iOS' })
  })

  it('identifies Safari on macOS', () => {
    expect(describeUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    )).toEqual({ browser: 'Safari', os: 'macOS' })
  })

  it('reads Android rather than the Linux token it also carries', () => {
    expect(describeUserAgent(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    ).os).toBe('Android')
  })

  it('degrades to nulls for an unknown or missing agent', () => {
    expect(describeUserAgent('curl/8.5.0')).toEqual({ browser: null, os: null })
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null })
    expect(describeUserAgent(undefined)).toEqual({ browser: null, os: null })
    expect(describeUserAgent('')).toEqual({ browser: null, os: null })
  })
})

describe('formatDeviceLabel', () => {
  it('joins what it could identify', () => {
    expect(formatDeviceLabel(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
    )).toBe('Chrome · Windows')
  })

  it('keeps the half it recognised', () => {
    expect(formatDeviceLabel('Mozilla/5.0 (Windows NT 10.0) SomeUnknownBrowser/1.0')).toBe('Windows')
  })

  // Never invents user-facing text — the caller supplies localized fallback copy.
  it('returns null when nothing is recognisable', () => {
    expect(formatDeviceLabel('curl/8.5.0')).toBeNull()
    expect(formatDeviceLabel(null)).toBeNull()
  })
})

describe('accountFormSchemas', () => {
  // The resolver echoes the key, so a failure names the message it would show.
  const schemas = accountFormSchemas(key => key)

  it('requires a name and rejects a whitespace-only one', () => {
    expect(schemas.profile.safeParse({ name: 'Anna Kowalska' }).success).toBe(true)
    expect(schemas.profile.safeParse({ name: '   ' }).success).toBe(false)
    expect(schemas.profile.safeParse({ name: 'x'.repeat(101) }).success).toBe(false)
  })

  it('validates the email address', () => {
    expect(schemas.email.safeParse({ email: 'anna@example.com' }).success).toBe(true)
    expect(schemas.email.safeParse({ email: 'not-an-email' }).success).toBe(false)
    expect(schemas.email.safeParse({ email: '' }).success).toBe(false)
  })

  it('enforces the minimum length Better Auth itself enforces', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    const ok = 'a'.repeat(MIN_PASSWORD_LENGTH)

    expect(schemas.password.safeParse({
      currentPassword: 'old-password',
      newPassword: short,
      confirmPassword: short
    }).success).toBe(false)

    expect(schemas.password.safeParse({
      currentPassword: 'old-password',
      newPassword: ok,
      confirmPassword: ok
    }).success).toBe(true)
  })

  it('reports a mismatched confirmation against the confirm field', () => {
    const result = schemas.password.safeParse({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      confirmPassword: 'new-passwerd'
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword'])
    expect(result.error?.issues[0]?.message).toBe('account.errors.passwordMismatch')
  })

  it('requires the current password', () => {
    expect(schemas.password.safeParse({
      currentPassword: '',
      newPassword: 'new-password',
      confirmPassword: 'new-password'
    }).success).toBe(false)
  })
})
