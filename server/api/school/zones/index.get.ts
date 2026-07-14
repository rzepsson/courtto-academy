import { AREA_ROLES } from '../../../../shared/permissions'

// The facility's zones in display order, each with its active court count. School
// roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const zones = await listZones(membership.organization.id)
  return { zones }
})
