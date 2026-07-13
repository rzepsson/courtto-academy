import { AREA_ROLES } from '../../../../../shared/permissions'

// This court's slice of the calendar — its lessons + maintenance blocks whose
// range overlaps [from, to). The org+court-scoped services make a foreign/unknown
// court id simply return nothing (the page's court fetch handles the 404), so no
// separate existence check is needed here. School roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const courtId = getRouterParam(event, 'id')
  if (!courtId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const query = getQuery(event)
  const from = parseInstant(query.from) ?? new Date()
  const to = parseInstant(query.to) ?? new Date(from.getTime() + 14 * 86_400_000)
  if (from.getTime() >= to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range', data: { code: 'SCHEDULE_INVALID_RANGE' } })
  }

  const orgId = membership.organization.id
  const [sessions, blocks] = await Promise.all([
    listSessions(orgId, { from, to, courtId }),
    listCourtBlocks(orgId, { from, to, courtId })
  ])
  return { sessions, blocks }
})
