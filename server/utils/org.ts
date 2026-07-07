import type { H3Event } from 'h3'
import { resolveActiveMembership } from '../../shared/permissions'
import type { OrgRole } from '../../shared/permissions'

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
