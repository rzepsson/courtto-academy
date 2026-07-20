import { AREA_ROLES } from '../../../../../../shared/permissions'

// Record a consent decision for one purpose (school roles only). PUT, not PATCH:
// the request states the decision in full, and re-stating it is idempotent.
//
// The audit entry is the point, not a nicety: the consent row only holds current
// state, so this trail IS the art. 7(1) evidence that consent was given (and by
// whom) and when it was withdrawn.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string
  const type = getRouterParam(event, 'type') as string

  const result = await recordMemberConsent(orgId, memberId, type, await readBody(event), membership.id)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  await recordAudit({
    organizationId: orgId,
    action: result.granted ? 'member.consent_granted' : 'member.consent_withdrawn',
    actorMemberId: membership.id,
    targetMemberId: memberId,
    data: {
      actorName: session.user.name,
      consentType: type,
      // Who actually gave it (the guardian, or the member themselves) — the actor
      // above is only the staff member who keyed it in.
      givenBy: result.granted ? result.giver : null
    }
  })

  return { consent: result.consent }
})
