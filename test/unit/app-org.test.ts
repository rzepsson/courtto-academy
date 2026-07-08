import { describe, expect, it } from 'vitest'
import {
  activeMembershipOf,
  extractInvitationId,
  resolveJoinTarget,
  sanitizeRedirect,
  slugify,
  validateSchoolForm,
  SLUG_PATTERN
} from '../../app/utils/org'

// validateSchoolForm takes an i18n `t`; the identity function keeps assertions
// about which message key fired readable.
const t = (key: string) => key

describe('activeMembershipOf', () => {
  const memberships = [
    { organization: { id: 'org_1' }, role: 'owner' as const },
    { organization: { id: 'org_2' }, role: 'coach' as const }
  ]

  it('returns null when the context is null or undefined', () => {
    expect(activeMembershipOf(null)).toBeNull()
    expect(activeMembershipOf(undefined)).toBeNull()
  })

  it('resolves the active membership from the context', () => {
    expect(activeMembershipOf({ memberships, activeOrganizationId: 'org_2' })?.organization.id).toBe('org_2')
  })

  it('falls back to the first membership on a stale active id', () => {
    expect(activeMembershipOf({ memberships, activeOrganizationId: 'gone' })?.organization.id).toBe('org_1')
  })
})

describe('sanitizeRedirect', () => {
  it('allows internal absolute paths', () => {
    expect(sanitizeRedirect('/school')).toBe('/school')
    expect(sanitizeRedirect('/my/lessons?tab=1')).toBe('/my/lessons?tab=1')
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeRedirect('//evil.com')).toBe('/dashboard')
  })

  it('rejects absolute external URLs', () => {
    expect(sanitizeRedirect('https://evil.com')).toBe('/dashboard')
    expect(sanitizeRedirect('http://evil.com/path')).toBe('/dashboard')
  })

  it('rejects non-string and empty values', () => {
    expect(sanitizeRedirect(undefined)).toBe('/dashboard')
    expect(sanitizeRedirect(null)).toBe('/dashboard')
    expect(sanitizeRedirect(42)).toBe('/dashboard')
    expect(sanitizeRedirect('relative/path')).toBe('/dashboard')
    expect(sanitizeRedirect('')).toBe('/dashboard')
  })

  it('honours a custom fallback', () => {
    expect(sanitizeRedirect('//evil.com', '/login')).toBe('/login')
  })
})

describe('extractInvitationId', () => {
  it('extracts the id from a full invite URL', () => {
    expect(extractInvitationId('http://localhost:3000/invite/abc-123_XYZ')).toBe('abc-123_XYZ')
    expect(extractInvitationId('https://courtto.app/invite/tok3n')).toBe('tok3n')
  })

  it('accepts a bare invitation id', () => {
    expect(extractInvitationId('abc-123_XYZ')).toBe('abc-123_XYZ')
  })

  it('trims surrounding whitespace', () => {
    expect(extractInvitationId('   tok3n  ')).toBe('tok3n')
  })

  it('rejects junk and empty input', () => {
    expect(extractInvitationId('')).toBeNull()
    expect(extractInvitationId('   ')).toBeNull()
    expect(extractInvitationId('not a valid id!')).toBeNull()
    expect(extractInvitationId('https://evil.com/x')).toBeNull()
  })
})

describe('resolveJoinTarget', () => {
  it('routes a join link (URL) to the join page', () => {
    expect(resolveJoinTarget('https://courtto.app/join/ABCDEFGH')).toBe('/join/ABCDEFGH')
    expect(resolveJoinTarget('http://localhost:3000/join/ABCDEFGH?x=1')).toBe('/join/ABCDEFGH')
  })

  it('routes an invite link (URL) to the invite page', () => {
    expect(resolveJoinTarget('https://courtto.app/invite/tok3n_ID')).toBe('/invite/tok3n_ID')
  })

  it('treats a bare 8-char code as a join code, ignoring case and dashes', () => {
    expect(resolveJoinTarget('ABCDEFGH')).toBe('/join/ABCDEFGH')
    expect(resolveJoinTarget('abcd-efgh')).toBe('/join/ABCDEFGH')
    expect(resolveJoinTarget('  ABCD EFGH  ')).toBe('/join/ABCDEFGH')
  })

  it('falls back to an invitation id for a bare non-code token', () => {
    // Longer than 8 chars → not a join code, so treated as an invite id.
    expect(resolveJoinTarget('tok3n_invitation_id')).toBe('/invite/tok3n_invitation_id')
    // 8 chars but contains ambiguous 0/1 that the code alphabet excludes.
    expect(resolveJoinTarget('ABCD01GH')).toBe('/invite/ABCD01GH')
  })

  it('returns null for empty or junk input', () => {
    expect(resolveJoinTarget('')).toBeNull()
    expect(resolveJoinTarget('   ')).toBeNull()
    expect(resolveJoinTarget('not a code!')).toBeNull()
    expect(resolveJoinTarget('https://evil.com/x')).toBeNull()
  })
})

describe('SLUG_PATTERN / validateSchoolForm', () => {
  it('accepts valid slugs', () => {
    for (const slug of ['abc', 'a1', 'foo-bar', 'a-b-c', 'padel123']) {
      expect(SLUG_PATTERN.test(slug)).toBe(true)
    }
  })

  it('rejects uppercase, spaces and stray dashes', () => {
    for (const slug of ['Abc', 'foo bar', '-abc', 'abc-', 'foo--bar', 'ą', 'foo_bar', '']) {
      expect(SLUG_PATTERN.test(slug)).toBe(false)
    }
  })

  it('reports no errors for a valid form', () => {
    expect(validateSchoolForm({ name: 'Ace Tennis', slug: 'ace-tennis' }, t)).toEqual([])
  })

  it('requires a non-blank name', () => {
    const errors = validateSchoolForm({ name: '   ', slug: 'ace' }, t)
    expect(errors).toContainEqual({ name: 'name', message: 'onboarding.errors.nameRequired' })
  })

  it('requires a slug', () => {
    const errors = validateSchoolForm({ name: 'Ace', slug: '' }, t)
    expect(errors).toContainEqual({ name: 'slug', message: 'onboarding.errors.slugRequired' })
  })

  it('rejects an invalid slug', () => {
    const errors = validateSchoolForm({ name: 'Ace', slug: 'Not Valid' }, t)
    expect(errors).toContainEqual({ name: 'slug', message: 'onboarding.errors.slugInvalid' })
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Ace Tennis Club')).toBe('ace-tennis-club')
  })

  it('strips Polish diacritics', () => {
    expect(slugify('Łódź Padel')).toBe('lodz-padel')
    expect(slugify('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn')
  })

  it('collapses runs of separators and trims leading/trailing dashes', () => {
    expect(slugify('  --Foo   &&  Bar!!--  ')).toBe('foo-bar')
  })

  it('produces a slug that satisfies SLUG_PATTERN', () => {
    for (const name of ['Ace Tennis', 'Łódź Padel', 'Klub 123']) {
      expect(SLUG_PATTERN.test(slugify(name))).toBe(true)
    }
  })
})
