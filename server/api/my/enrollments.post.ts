import { AREA_ROLES } from '../../../shared/permissions'

// Self-enrol the signed-in student in a series OR a single session (drop-in).
// Body: exactly one of { seriesId } | { sessionId }. Student only. 404 when the
// target isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.my)

  const body = await readBody<Record<string, unknown>>(event)
  const seriesId = typeof body?.seriesId === 'string' ? body.seriesId : null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null
  if ((seriesId === null) === (sessionId === null)) {
    throw createError({ statusCode: 400, statusMessage: 'Provide exactly one of seriesId or sessionId' })
  }

  const orgId = membership.organization.id
  const result = seriesId
    ? await enrollInSeries(orgId, seriesId, membership.id)
    : await enrollInSession(orgId, sessionId!, membership.id)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { enrollment: result }
})
