import { AREA_ROLES } from '../../../../../shared/permissions'

// A member's Academy engagement over [from, to) — hours taught or trained, and in
// which groups (school roles only). Defaults to a rolling 30-day window ending now.
const DEFAULT_WINDOW_DAYS = 30
const MS_PER_DAY = 86_400_000

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const memberId = getRouterParam(event, 'id') as string
  const query = getQuery(event)

  const to = parseInstant(query.to) ?? new Date()
  const from = parseInstant(query.from) ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY)
  if (from.getTime() >= to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range', data: { code: 'SCHEDULE_INVALID_RANGE' } })
  }

  const academy = await getMemberAcademy(membership.organization.id, memberId, { from, to })
  if (!academy) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  return { academy }
})
