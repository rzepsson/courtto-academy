import { AREA_ROLES } from '../../../shared/permissions'

// The signed-in student's own sessions in [from, to) — the lessons they're
// enrolled in (series or drop-in), with their enrolment status. Student only.
function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.my)

  const query = getQuery(event)
  const from = parseInstant(query.from) ?? new Date()
  const to = parseInstant(query.to) ?? new Date(from.getTime() + 14 * 86_400_000)
  if (from.getTime() >= to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range', data: { code: 'SCHEDULE_INVALID_RANGE' } })
  }

  const orgId = membership.organization.id
  const [sessions, profile] = await Promise.all([
    listStudentSessions(orgId, membership.id, { from, to }),
    getOrgProfile(orgId)
  ])
  return { sessions, timezone: profile.timezone ?? 'Europe/Warsaw' }
})
