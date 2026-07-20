import { AREA_ROLES } from '../../../../shared/permissions'
import { parseMemberDirectoryQuery } from '../../../../shared/member-profile'

// The paginated / filterable member directory (school roles only). Thin: parse the
// query, scope to the active org, delegate to the service. The flat
// `/api/school/members` stays as-is for the schedule/court coach+student pickers.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const query = parseMemberDirectoryQuery(getQuery(event))
  return listMembersDirectory(membership.organization.id, query)
})
