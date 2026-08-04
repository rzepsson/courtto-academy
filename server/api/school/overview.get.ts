import { AREA_ROLES } from '../../../shared/permissions'

// The owner dashboard payload (KPIs, today's timetable, weekly occupancy, items
// needing attention, recent activity) in one call. School roles only; a GET, so
// the subscription gate never blocks it.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  return { overview: await getSchoolOverview(membership.organization.id) }
})
