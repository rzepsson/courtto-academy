import { AREA_ROLES } from '../../../../../../shared/permissions'

// Enrol a student in a single session (drop-in / make-up). Body: { studentMemberId }.
// School roles only. 404 when the session isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (typeof body?.studentMemberId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing studentMemberId' })
  }

  const result = await enrollInSession(membership.organization.id, id, body.studentMemberId)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return { enrollment: result }
})
