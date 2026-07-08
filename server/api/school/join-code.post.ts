import { AREA_ROLES } from '../../../shared/permissions'

// Create-or-rotate: issues a fresh code and invalidates the previous one. Same
// endpoint for the first generation and every later rotation.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  return { joinCode: await rotateOrgJoinCode(membership.organization.id, session.user.id) }
})
