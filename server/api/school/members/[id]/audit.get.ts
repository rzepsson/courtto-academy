import { AREA_ROLES } from '../../../../../shared/permissions'

// A member's governance activity timeline (school roles only). Confirms the member
// belongs to this org before exposing their trail (tenant isolation).
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string

  const target = await getMemberProfile(orgId, memberId)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  const entries = await listMemberAudit(orgId, memberId)
  return { entries }
})
