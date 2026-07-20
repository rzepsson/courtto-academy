import { AREA_ROLES } from '../../../../shared/permissions'

// Server-authoritative member removal (school roles only). The removal goes through
// Better Auth (`auth.api.removeMember`, rule 4); the guards + audit live here. The
// owner can never be removed (last-owner / lockout protection) and you can't remove
// yourself. This is a hard remove (drops the membership); archiving via the profile
// status keeps the row + history instead.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string

  const target = await getMemberDetail(orgId, memberId)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }
  if (target.role === 'owner') {
    throw createError({ statusCode: 409, statusMessage: 'Owner cannot be removed', data: { code: 'MEMBER_OWNER_REMOVE' } })
  }
  if (target.user.id === session.user.id) {
    throw createError({ statusCode: 409, statusMessage: 'Cannot remove yourself', data: { code: 'MEMBER_SELF_ACTION' } })
  }

  await auth.api.removeMember({
    body: { memberIdOrEmail: memberId, organizationId: orgId },
    headers: event.headers
  })

  await recordAudit({
    organizationId: orgId,
    action: 'member.removed',
    actorMemberId: membership.id,
    targetMemberId: memberId,
    data: { actorName: session.user.name, targetName: target.user.name, role: target.role }
  })

  return { ok: true }
})
