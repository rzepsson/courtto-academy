import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access'

// Imported by both `server/utils/auth.ts` (also loaded standalone by the `auth`
// CLI — keep this file free of Nuxt aliases) and `app/utils/auth-client.ts`,
// so server and client always agree on roles and permissions.
export const ac = createAccessControl(defaultStatements)

export const roles = {
  owner: ac.newRole(ownerAc.statements),
  admin: ac.newRole(adminAc.statements),
  coach: ac.newRole(memberAc.statements),
  student: ac.newRole(memberAc.statements),
  parent: ac.newRole(memberAc.statements)
}

export const ORG_ROLES = ['owner', 'admin', 'coach', 'student', 'parent'] as const

export type OrgRole = (typeof ORG_ROLES)[number]

export const INVITABLE_ROLES = ['admin', 'coach', 'student', 'parent'] as const satisfies readonly OrgRole[]

export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value)
}

// The single source of truth for role → area routing. Each area maps to a
// top-level route (`/school`, `/coach`, `/my`) and the roles that live there.
// Client middleware, server guards, the sidebar nav and roleHome() all derive
// from this — adding a role or moving one between areas is a one-line change.
export const AREAS = ['school', 'coach', 'my'] as const

export type Area = (typeof AREAS)[number]

export const AREA_ROLES = {
  school: ['owner', 'admin'],
  coach: ['coach'],
  my: ['student', 'parent']
} as const satisfies Record<Area, readonly OrgRole[]>

// Unknown/legacy roles fall into the least-privileged area so they always land
// somewhere reachable (never a redirect loop) instead of throwing.
export function roleArea(role: OrgRole): Area {
  return AREAS.find(area => (AREA_ROLES[area] as readonly OrgRole[]).includes(role)) ?? 'my'
}

export function roleHome(role: OrgRole): string {
  return `/${roleArea(role)}`
}

// Find-or-first active-membership resolution, shared by the server
// (/api/app-context, requireActiveMembership) and the client (activeMembershipOf)
// so both always agree on which org is active. Generic over the membership
// shape to accept both server types and their serialized useFetch counterparts.
export function resolveActiveMembership<T extends { organization: { id: string } }>(
  memberships: T[],
  activeOrganizationId: string | null | undefined
): T | null {
  if (memberships.length === 0) {
    return null
  }

  return memberships.find(m => m.organization.id === activeOrganizationId)
    ?? memberships[0]
    ?? null
}
