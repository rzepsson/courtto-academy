import { AREA_ROLES } from '../../../../shared/permissions'

// Lists the facility's courts in display order. `?includeArchived=1` adds the
// soft-deleted ones (for the archived view). School roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const query = getQuery(event)
  const includeArchived = query.includeArchived === '1' || query.includeArchived === 'true'

  const courts = await listCourts(membership.organization.id, { includeArchived })
  return { courts }
})
