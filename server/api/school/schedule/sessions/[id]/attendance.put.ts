import { AREA_ROLES } from '../../../../../../shared/permissions'

// Mark attendance for a session (bulk). Body: { entries: [{ studentMemberId,
// status }] }. Staff can mark any session. Returns the refreshed roster. 404
// when the session isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const body = await readBody<{ entries?: unknown }>(event)
  const roster = await markAttendance(membership.organization.id, id, body?.entries, membership.id)
  if (!roster) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return { roster }
})
