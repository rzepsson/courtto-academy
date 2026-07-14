import { AREA_ROLES } from '../../../../../shared/permissions'

// This court's utilization over [from, to) — booked (usage) vs downtime hours, a
// weekday×hour demand heatmap, and an occupancy %. Computed from the core
// reservation rows, so it's org+court-scoped and a foreign court simply yields
// zeros (the page's court fetch handles the 404). School roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const courtId = getRouterParam(event, 'id')
  if (!courtId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const query = getQuery(event)
  const to = parseInstant(query.to) ?? new Date()
  const from = parseInstant(query.from) ?? new Date(to.getTime() - 30 * 86_400_000)
  if (from.getTime() >= to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range', data: { code: 'SCHEDULE_INVALID_RANGE' } })
  }

  const utilization = await getCourtUtilization(membership.organization.id, courtId, from, to)
  return { utilization }
})
