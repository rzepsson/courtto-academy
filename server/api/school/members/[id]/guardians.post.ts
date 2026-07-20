import { AREA_ROLES } from '../../../../../shared/permissions'

// Add a guardian contact to a member (school roles only). Thin: the service owns
// validation, the per-member cap and the single-primary invariant.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const memberId = getRouterParam(event, 'id') as string

  const guardian = await createMemberGuardian(membership.organization.id, memberId, await readBody(event))
  if (!guardian) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  setResponseStatus(event, 201)
  return { guardian }
})
