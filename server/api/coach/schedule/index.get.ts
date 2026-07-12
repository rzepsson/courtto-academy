import { AREA_ROLES } from '../../../../shared/permissions'

// The signed-in coach's own sessions in [from, to) — their teaching calendar.
// `from`/`to` are ISO instants; absent → a default two-week window. Coach only.
function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.coach)

  const query = getQuery(event)
  const from = parseInstant(query.from) ?? new Date()
  const to = parseInstant(query.to) ?? new Date(from.getTime() + 14 * 86_400_000)
  if (from.getTime() >= to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range', data: { code: 'SCHEDULE_INVALID_RANGE' } })
  }

  const orgId = membership.organization.id
  const [sessions, profile] = await Promise.all([
    listSessions(orgId, { from, to, coachMemberId: membership.id }),
    getOrgProfile(orgId)
  ])
  return { sessions, timezone: profile.timezone ?? 'Europe/Warsaw' }
})
