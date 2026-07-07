import { describe, expect, it } from 'vitest'
// These helpers live in a module that imports `db`, but postgres-js connects
// lazily, so importing here (with the placeholder DATABASE_URL from
// vitest.config.ts) never opens a socket.
import { maskEmail, toOrgRole } from '../../server/utils/services/membership'
import { ORG_ROLES } from '../../shared/permissions'

describe('toOrgRole', () => {
  it('passes through every known role', () => {
    for (const role of ORG_ROLES) {
      expect(toOrgRole(role)).toBe(role)
    }
  })

  it('coerces unknown DB strings to the least-privileged role', () => {
    expect(toOrgRole('member')).toBe('student')
    expect(toOrgRole('superuser')).toBe('student')
    expect(toOrgRole('')).toBe('student')
  })

  it('coerces null to the least-privileged role', () => {
    expect(toOrgRole(null)).toBe('student')
  })
})

describe('maskEmail', () => {
  it('reveals only the first character of the local part', () => {
    expect(maskEmail('alice@example.com')).toBe('a****@example.com')
  })

  it('never leaks more than the first char even for long locals', () => {
    const masked = maskEmail('verylongusername@example.com')
    expect(masked.startsWith('v')).toBe(true)
    // Everything between the first char and '@' must be asterisks only.
    const local = masked.split('@')[0]!
    expect(local.slice(1)).toMatch(/^\*+$/)
    expect(local).not.toContain('e') // no leaked characters from "verylong..."
  })

  it('pads short local parts to at least two asterisks', () => {
    // A single-char local would otherwise reveal its entire length; the mask
    // enforces a minimum of two stars.
    expect(maskEmail('a@example.com')).toBe('a**@example.com')
    expect(maskEmail('ab@example.com')).toBe('a**@example.com')
  })

  it('preserves the domain', () => {
    expect(maskEmail('bob@padel.club').endsWith('@padel.club')).toBe(true)
  })
})
