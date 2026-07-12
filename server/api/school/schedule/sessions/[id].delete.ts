import { AREA_ROLES } from '../../../../../shared/permissions'

// Cancels a single occurrence (soft): frees its court, marks the session
// cancelled and records an EXDATE so re-materialization never regenerates it.
// Optional `?reason=`. School roles only. 404 when not this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const query = getQuery(event)
  const reason = typeof query.reason === 'string' ? query.reason : undefined

  const session = await cancelLessonSession(membership.organization.id, id, reason)
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return { session }
})
