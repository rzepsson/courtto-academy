import { AREA_ROLES } from '../../../../../shared/permissions'

// A member's consent decisions, one entry per known purpose (school roles only).
// Purposes with no decision come back as `unknown` rather than being omitted — the
// gap is the actionable part.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const memberId = getRouterParam(event, 'id') as string

  const consents = await listMemberConsents(membership.organization.id, memberId)
  if (!consents) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  return { consents }
})
