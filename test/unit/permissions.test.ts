import { describe, expect, it } from 'vitest'
import {
  AREAS,
  AREA_ROLES,
  INVITABLE_ROLES,
  ORG_ROLES,
  isOrgRole,
  resolveActiveMembership,
  roleArea,
  roleHome
} from '../../shared/permissions'
import type { OrgRole } from '../../shared/permissions'

// A membership factory small enough to inline; only `organization.id` is read
// by resolveActiveMembership, but we keep the role to document intent.
function membership(orgId: string, role: OrgRole = 'owner') {
  return { organization: { id: orgId }, role }
}

describe('isOrgRole', () => {
  it('accepts every known role', () => {
    for (const role of ORG_ROLES) {
      expect(isOrgRole(role)).toBe(true)
    }
  })

  it('rejects unknown / legacy role strings', () => {
    expect(isOrgRole('member')).toBe(false)
    expect(isOrgRole('MEMBER')).toBe(false)
    expect(isOrgRole('')).toBe(false)
    expect(isOrgRole('superuser')).toBe(false)
  })
})

describe('roleArea', () => {
  it('routes owner and admin to the school area', () => {
    expect(roleArea('owner')).toBe('school')
    expect(roleArea('admin')).toBe('school')
  })

  it('routes coach to the coach area', () => {
    expect(roleArea('coach')).toBe('coach')
  })

  it('routes student to the my area', () => {
    expect(roleArea('student')).toBe('my')
  })

  // Regression guard: an unknown/legacy role must resolve to a reachable area so
  // area middleware never bounces it between two guards that both reject it.
  // 'parent' is a retired role (merged into student) and must still land in /my.
  it('falls back to the my area for an unknown role', () => {
    expect(roleArea('ghost' as OrgRole)).toBe('my')
    expect(roleArea('member' as OrgRole)).toBe('my')
    expect(roleArea('parent' as OrgRole)).toBe('my')
  })

  it('every declared area is covered by AREA_ROLES', () => {
    for (const area of AREAS) {
      expect(AREA_ROLES[area].length).toBeGreaterThan(0)
    }
  })
})

describe('roleHome', () => {
  it('prefixes the area with a slash', () => {
    expect(roleHome('owner')).toBe('/school')
    expect(roleHome('coach')).toBe('/coach')
    expect(roleHome('student')).toBe('/my')
  })

  it('sends an unknown role to /my', () => {
    expect(roleHome('ghost' as OrgRole)).toBe('/my')
  })
})

describe('INVITABLE_ROLES', () => {
  it('never allows inviting an owner', () => {
    expect(INVITABLE_ROLES).not.toContain('owner')
  })

  it('is a subset of ORG_ROLES', () => {
    for (const role of INVITABLE_ROLES) {
      expect(ORG_ROLES).toContain(role)
    }
  })
})

describe('resolveActiveMembership', () => {
  it('returns null for an empty membership list', () => {
    expect(resolveActiveMembership([], 'org_1')).toBeNull()
    expect(resolveActiveMembership([], null)).toBeNull()
  })

  it('picks the membership matching the active organization id', () => {
    const memberships = [membership('org_1'), membership('org_2', 'coach')]
    expect(resolveActiveMembership(memberships, 'org_2')?.organization.id).toBe('org_2')
  })

  it('falls back to the first membership when the active id is stale', () => {
    const memberships = [membership('org_1'), membership('org_2')]
    expect(resolveActiveMembership(memberships, 'org_removed')?.organization.id).toBe('org_1')
  })

  it('falls back to the first membership when the active id is null or undefined', () => {
    const memberships = [membership('org_1'), membership('org_2')]
    expect(resolveActiveMembership(memberships, null)?.organization.id).toBe('org_1')
    expect(resolveActiveMembership(memberships, undefined)?.organization.id).toBe('org_1')
  })
})
