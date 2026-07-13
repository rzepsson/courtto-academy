import { AREA_ROLES } from '../../../../../shared/permissions'

// This court's maintenance/closure blocks overlapping [from, to) — the detail
// page's "maintenance" list. Defaults to a forward window (now → +180d) so it
// shows all upcoming closures independent of the calendar's day/week nav. School
// roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const courtId = getRouterParam(event, 'id')
  if (!courtId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const query = getQuery(event)
  const from = parseInstant(query.from) ?? new Date()
  const to = parseInstant(query.to) ?? new Date(from.getTime() + 180 * 86_400_000)

  const blocks = await listCourtBlocks(membership.organization.id, { from, to, courtId })
  return { blocks }
})
