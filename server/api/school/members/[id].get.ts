import { AREA_ROLES } from '../../../../shared/permissions'

// A single member's detail record for the cockpit (school roles only). The static
// `directory`/`export` siblings win over this dynamic route in Nitro, so a real
// member id resolves here. 404 (never null) when the id isn't this org's member.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const memberId = getRouterParam(event, 'id') as string

  const member = await getMemberDetail(membership.organization.id, memberId)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  return { member }
})
