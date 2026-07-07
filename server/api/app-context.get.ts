import { resolveActiveMembership } from '../../shared/permissions'
import type { AppContext } from '../database/types'

export default defineEventHandler(async (event): Promise<AppContext> => {
  const { user, session } = await requireUserSession(event)
  const memberships = await listUserMemberships(user.id)

  // The session's active org can go stale (e.g. after being removed from a
  // school), so validate it against actual memberships before returning.
  const active = resolveActiveMembership(memberships, session.activeOrganizationId)

  return {
    memberships,
    activeOrganizationId: active?.organization.id ?? null
  }
})
