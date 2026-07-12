import { AREA_ROLES } from '../../../../shared/permissions'

// Sessions whose start falls in [from, to), flattened with their series display
// fields — the calendar/roster feed. `from`/`to` are ISO instants; absent →
// a default two-week window from now. School roles only.
function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const query = getQuery(event)
  const from = parseInstant(query.from) ?? new Date()
  const to = parseInstant(query.to) ?? new Date(from.getTime() + 14 * 86_400_000)
  if (from.getTime() >= to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range', data: { code: 'SCHEDULE_INVALID_RANGE' } })
  }

  const sessions = await listSessions(membership.organization.id, { from, to })
  return { sessions }
})
