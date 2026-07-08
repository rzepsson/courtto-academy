import { AREA_ROLES } from '../../../shared/permissions'

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  return { profile: await getOrgProfile(membership.organization.id) }
})
