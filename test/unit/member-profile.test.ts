import { describe, expect, it } from 'vitest'
import {
  MEMBER_PROFILE_LIMITS,
  canMemberCoach,
  isMemberDirectorySort,
  isMemberStatus,
  normalizeTag,
  normalizeTags,
  parseMemberDirectoryQuery,
  toMemberStatus
} from '../../shared/member-profile'
import { memberProfilePatchSchema, memberProfileSchema } from '../../shared/member-profile-schema'

// Identity resolver: error messages are the raw codes, so tests assert on them.
const raw = (code: string) => code
const schema = memberProfileSchema(raw)
const patch = memberProfilePatchSchema(raw)

describe('member status', () => {
  it('recognizes the valid statuses and rejects others', () => {
    expect(isMemberStatus('active')).toBe(true)
    expect(isMemberStatus('suspended')).toBe(true)
    expect(isMemberStatus('archived')).toBe(true)
    expect(isMemberStatus('deleted')).toBe(false)
    expect(isMemberStatus('')).toBe(false)
  })

  it('coerces unknown/legacy values to active', () => {
    expect(toMemberStatus('suspended')).toBe('suspended')
    expect(toMemberStatus('member')).toBe('active') // Better Auth's legacy default
    expect(toMemberStatus(null)).toBe('active')
    expect(toMemberStatus(undefined)).toBe('active')
  })
})

describe('canMemberCoach', () => {
  it('always allows a coach, with or without the flag', () => {
    expect(canMemberCoach({ role: 'coach', canCoach: false })).toBe(true)
    expect(canMemberCoach({ role: 'coach', canCoach: true })).toBe(true)
  })

  it('allows an owner/admin only once the capability is granted', () => {
    expect(canMemberCoach({ role: 'owner', canCoach: false })).toBe(false)
    expect(canMemberCoach({ role: 'owner', canCoach: true })).toBe(true)
    expect(canMemberCoach({ role: 'admin', canCoach: false })).toBe(false)
    expect(canMemberCoach({ role: 'admin', canCoach: true })).toBe(true)
  })

  it('never allows a student by role alone', () => {
    expect(canMemberCoach({ role: 'student', canCoach: false })).toBe(false)
  })

  it('is orthogonal to lifecycle status — callers check that separately', () => {
    // The predicate answers "set up to coach?" only; a suspended coach still
    // returns true here and is rejected by the caller's status check.
    expect(canMemberCoach({ role: 'coach', canCoach: false })).toBe(true)
  })
})

describe('directory sort guard', () => {
  it('accepts known sort keys only', () => {
    expect(isMemberDirectorySort('name')).toBe(true)
    expect(isMemberDirectorySort('joined')).toBe(true)
    expect(isMemberDirectorySort('status')).toBe(true)
    expect(isMemberDirectorySort('email')).toBe(false)
  })
})

describe('normalizeTag / normalizeTags', () => {
  it('trims, collapses inner whitespace, and drops empties', () => {
    expect(normalizeTag('  competitive  ')).toBe('competitive')
    expect(normalizeTag('junior   squad')).toBe('junior squad')
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('')).toBeNull()
  })

  it('caps a single tag at the length limit', () => {
    const long = 'x'.repeat(MEMBER_PROFILE_LIMITS.tag + 10)
    expect(normalizeTag(long)).toHaveLength(MEMBER_PROFILE_LIMITS.tag)
  })

  it('dedupes case-insensitively while preserving display casing and order', () => {
    expect(normalizeTags(['Beginner', 'beginner', 'Competitive', '  ', 'BEGINNER']))
      .toEqual(['Beginner', 'Competitive'])
  })
})

describe('memberProfileSchema', () => {
  // A complete, valid profile; each test overrides only the field under test.
  const base = { status: 'active', canCoach: false, dateOfBirth: '', notes: '', tags: [] }

  it('accepts a full valid profile and normalizes it', () => {
    const result = schema.parse({
      ...base,
      status: 'suspended',
      canCoach: true,
      dateOfBirth: '2010-05-04',
      notes: '  needs make-up sessions  ',
      tags: ['Beginner', 'beginner']
    })
    expect(result).toEqual({
      status: 'suspended',
      canCoach: true,
      dateOfBirth: '2010-05-04',
      notes: 'needs make-up sessions',
      tags: ['Beginner']
    })
  })

  it('collapses a whitespace-only note to null (clears it)', () => {
    expect(schema.parse({ ...base, notes: '   ' }).notes).toBeNull()
  })

  it('treats an empty date of birth as “not recorded”, not an error', () => {
    expect(schema.parse({ ...base, dateOfBirth: '' }).dateOfBirth).toBeNull()
  })

  it('rejects a malformed, impossible or future date of birth', () => {
    for (const dateOfBirth of ['not-a-date', '2026-02-31', '2099-01-01', '1090-01-01']) {
      const result = schema.safeParse({ ...base, dateOfBirth })
      expect(result.success).toBe(false)
      expect(result.error!.issues[0]!.message).toBe('date')
    }
  })

  it('rejects an invalid status with the stable code', () => {
    const result = schema.safeParse({ ...base, status: 'gone' })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toBe('status')
  })

  it('rejects a note over the length limit', () => {
    const result = schema.safeParse({ ...base, notes: 'x'.repeat(MEMBER_PROFILE_LIMITS.notes + 1) })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toBe('tooLong')
  })

  it('rejects more tags than the limit after normalization', () => {
    const tooMany = Array.from({ length: MEMBER_PROFILE_LIMITS.tags + 1 }, (_, i) => `tag-${i}`)
    const result = schema.safeParse({ ...base, tags: tooMany })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toBe('tags')
  })
})

describe('memberProfilePatchSchema', () => {
  it('validates only the keys present, leaving others untouched', () => {
    const result = patch.parse({ canCoach: true })
    expect(result).toEqual({ canCoach: true })
    expect(result).not.toHaveProperty('status')
  })

  it('still rejects a bad value on a present key', () => {
    expect(patch.safeParse({ status: 'nope' }).success).toBe(false)
  })
})

describe('parseMemberDirectoryQuery', () => {
  it('parses a full valid query', () => {
    expect(parseMemberDirectoryQuery({
      search: '  ada  ',
      roles: ['owner', 'coach'],
      statuses: ['active', 'archived'],
      canCoach: 'true',
      sort: 'joined',
      order: 'desc',
      page: '3',
      pageSize: '50'
    })).toEqual({
      search: 'ada',
      roles: ['owner', 'coach'],
      statuses: ['active', 'archived'],
      canCoach: true,
      sort: 'joined',
      order: 'desc',
      page: 3,
      pageSize: 50
    })
  })

  it('drops unknown roles/statuses/sort rather than erroring (graceful degrade)', () => {
    const result = parseMemberDirectoryQuery({
      roles: ['owner', 'wizard'],
      statuses: ['active', 'deleted'],
      sort: 'salary',
      order: 'sideways'
    })
    expect(result.roles).toEqual(['owner'])
    expect(result.statuses).toEqual(['active'])
    expect(result.sort).toBeUndefined()
    expect(result.order).toBeUndefined()
  })

  it('coerces a single string param into an array', () => {
    expect(parseMemberDirectoryQuery({ roles: 'student' }).roles).toEqual(['student'])
  })

  it('treats an empty search and empty filters as absent', () => {
    const result = parseMemberDirectoryQuery({ search: '   ', roles: [] })
    expect(result.search).toBeUndefined()
    expect(result.roles).toBeUndefined()
  })

  it('reads canCoach only from the literal strings', () => {
    expect(parseMemberDirectoryQuery({ canCoach: 'true' }).canCoach).toBe(true)
    expect(parseMemberDirectoryQuery({ canCoach: 'false' }).canCoach).toBe(false)
    expect(parseMemberDirectoryQuery({ canCoach: '1' }).canCoach).toBeUndefined()
    expect(parseMemberDirectoryQuery({}).canCoach).toBeUndefined()
  })

  it('accepts only positive integer page / pageSize', () => {
    expect(parseMemberDirectoryQuery({ page: '2', pageSize: '25' })).toMatchObject({ page: 2, pageSize: 25 })
    expect(parseMemberDirectoryQuery({ page: '0' }).page).toBeUndefined()
    expect(parseMemberDirectoryQuery({ page: '-1' }).page).toBeUndefined()
    expect(parseMemberDirectoryQuery({ pageSize: 'abc' }).pageSize).toBeUndefined()
    expect(parseMemberDirectoryQuery({ pageSize: '2.5' }).pageSize).toBeUndefined()
  })
})
