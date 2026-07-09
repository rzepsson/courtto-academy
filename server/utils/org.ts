import type { H3Event } from 'h3'
import { resolveActiveMembership } from '../../shared/permissions'
import type { OrgRole } from '../../shared/permissions'

// Resolves the caller and their validated active org id — the scope the
// notification bell reads/writes against. Mirrors app-context's find-or-first
// resolution so a stale session.activeOrganizationId never leaks another org's
// scope. `activeOrgId` is null when the user has no (valid) active membership.
export async function getActiveScope(event: H3Event): Promise<{ userId: string, activeOrgId: string | null }> {
  const session = await requireUserSession(event)
  const memberships = await listUserMemberships(session.user.id)
  const active = resolveActiveMembership(memberships, session.session.activeOrganizationId)
  return { userId: session.user.id, activeOrgId: active?.organization.id ?? null }
}

export async function requireActiveMembership(event: H3Event, allowedRoles?: readonly OrgRole[]) {
  const session = await requireUserSession(event)
  const memberships = await listUserMemberships(session.user.id)

  // Resolve the active org the same way the client does (find-or-first): the
  // stored session.activeOrganizationId can be stale after the user is removed
  // from that school, and we must not 403 a user who still has other schools.
  const membership = resolveActiveMembership(memberships, session.session.activeOrganizationId)

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'No active organization' })
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Insufficient role' })
  }

  return { session, membership }
}
