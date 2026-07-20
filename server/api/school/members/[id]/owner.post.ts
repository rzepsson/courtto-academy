import { AREA_ROLES } from '../../../../../shared/permissions'

// Transfer school ownership to another member. **Only the current owner** may do
// this (a school-role guard isn't enough — an admin must never be able to seize or
// hand off ownership), and it's the only path that mutates the owner role at all:
// `role.patch` deliberately refuses to touch an owner.
//
// Better Auth has no native ownership transfer, so this is two `updateMemberRole`
// calls. They can't share a transaction, so the ORDER is the safety property:
// promote the target FIRST, then demote the outgoing owner. If the second call
// fails the school briefly has two owners — benign and self-correctable. The
// reverse order could leave the school with NO owner, which is unrecoverable
// through the UI. We report the partial state explicitly rather than hiding it.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string

  if (membership.role !== 'owner') {
    throw createError({ statusCode: 403, statusMessage: 'Only the owner can transfer ownership', data: { code: 'MEMBER_OWNER_ONLY' } })
  }

  const target = await getMemberDetail(orgId, memberId)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }
  if (target.id === membership.id) {
    throw createError({ statusCode: 409, statusMessage: 'Cannot transfer ownership to yourself', data: { code: 'MEMBER_SELF_ACTION' } })
  }
  if (target.role === 'owner') {
    throw createError({ statusCode: 409, statusMessage: 'That member already owns this school', data: { code: 'MEMBER_ALREADY_OWNER' } })
  }
  // Handing the school to someone who can't sign in would strand it.
  if (target.status !== 'active') {
    throw createError({ statusCode: 409, statusMessage: 'The new owner must be an active member', data: { code: 'MEMBER_OWNER_INACTIVE' } })
  }

  await auth.api.updateMemberRole({
    body: { memberId: target.id, role: 'owner', organizationId: orgId },
    headers: event.headers
  })

  try {
    await auth.api.updateMemberRole({
      body: { memberId: membership.id, role: 'admin', organizationId: orgId },
      headers: event.headers
    })
  } catch {
    // The target IS the owner now; we just failed to step down. Surface it so the
    // admin knows to retry the demotion rather than believing nothing happened.
    throw createError({
      statusCode: 500,
      statusMessage: 'Ownership transferred but the previous owner was not demoted',
      data: { code: 'MEMBER_OWNER_DEMOTE_FAILED' }
    })
  }

  await recordAudit({
    organizationId: orgId,
    action: 'member.ownership_transferred',
    actorMemberId: membership.id,
    targetMemberId: target.id,
    data: { actorName: session.user.name, targetName: target.user.name }
  })

  return { ok: true }
})
