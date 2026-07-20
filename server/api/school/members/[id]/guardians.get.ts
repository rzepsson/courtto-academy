import { AREA_ROLES } from '../../../../../shared/permissions'

// A member's guardian contacts (school roles only — this is PII). Confirms the
// member belongs to this org before exposing anything.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string

  const target = await getMemberProfile(orgId, memberId)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  return { guardians: await listMemberGuardians(orgId, memberId) }
})
