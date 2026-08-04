import type { H3Event } from 'h3'
import { resolveActiveMembership } from '../../shared/permissions'
import type { OrgRole } from '../../shared/permissions'

// State-changing methods the subscription gate applies to. An absent method (e.g.
// a unit-style caller) is treated as a read, so the gate never fires without an
// explicit mutating verb.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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

export async function requireActiveMembership(
  event: H3Event,
  allowedRoles?: readonly OrgRole[],
  opts?: { allowUnentitled?: boolean }
) {
  const session = await requireUserSession(event)
  const memberships = await listUserMemberships(session.user.id)

  // Resolve the active org the same way the client does (find-or-first): the
  // stored session.activeOrganizationId can be stale after the user is removed
  // from that school, and we must not 403 a user who still has other schools.
  const membership = resolveActiveMembership(memberships, session.session.activeOrganizationId)

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'No active organization' })
  }

  // A suspended/archived membership keeps the row (and appears in app-context so
  // the client can route to /access-paused) but is denied every area API. The
  // owner can never be non-active (guarded on write), so this can't lock a school.
  if (membership.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Membership inactive', data: { code: 'MEMBERSHIP_INACTIVE' } })
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Insufficient role' })
  }

  // Subscription gate: a school off an active plan (trial elapsed or payment
  // lapsed) can still READ — the client routes it to /billing-required — but may
  // not MUTATE (no operating a school you aren't paying for). Reads and the billing
  // read (allowUnentitled) bypass; Better-Auth-native subscription calls never pass
  // through here, so the owner can always reach checkout/portal to fix it. Runs
  // after the role check so a mis-scoped call still 403s first.
  if (!opts?.allowUnentitled && MUTATING_METHODS.has(event.method)) {
    const entitlement = await getOrgEntitlement(membership.organization.id)
    if (!entitlement.entitled) {
      throw createError({ statusCode: 402, statusMessage: 'Subscription required', data: { code: 'SUBSCRIPTION_INACTIVE' } })
    }
  }

  return { session, membership }
}
