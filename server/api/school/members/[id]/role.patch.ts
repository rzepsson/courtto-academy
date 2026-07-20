import { AREA_ROLES, INVITABLE_ROLES } from '../../../../../shared/permissions'
import type { InvitableRole } from '../../../../../shared/permissions'

// Server-authoritative role change (school roles only): the mutation itself goes
// through Better Auth (`auth.api.updateMemberRole`, rule 4), but the governance
// guards + audit trail live here so they can't be bypassed by a client calling
// Better Auth directly. The owner's role is immutable and you can't change your
// own — both prevent a school from losing its last owner / an admin self-locking.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string

  const body = await readBody(event)
  const role = body?.role
  if (typeof role !== 'string' || !(INVITABLE_ROLES as readonly string[]).includes(role)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid role', data: { code: 'INVALID_ROLE' } })
  }

  const target = await getMemberDetail(orgId, memberId)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }
  if (target.role === 'owner') {
    throw createError({ statusCode: 409, statusMessage: 'Owner role is protected', data: { code: 'MEMBER_OWNER_ROLE' } })
  }
  if (target.user.id === session.user.id) {
    throw createError({ statusCode: 409, statusMessage: 'Cannot change your own role', data: { code: 'MEMBER_SELF_ACTION' } })
  }
  if (target.role === role) {
    return { ok: true }
  }

  await auth.api.updateMemberRole({
    body: { memberId, role, organizationId: orgId },
    headers: event.headers
  })

  await recordAudit({
    organizationId: orgId,
    action: 'member.role_changed',
    actorMemberId: membership.id,
    targetMemberId: memberId,
    data: { actorName: session.user.name, targetName: target.user.name, role: role as InvitableRole }
  })

  return { ok: true }
})
