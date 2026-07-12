import { AREA_ROLES } from '../../../../../../shared/permissions'

// Mark attendance for one of the signed-in coach's OWN sessions (a foreign
// session is 403). Body: { entries: [{ studentMemberId, status }] }. Coach only.
// 404 when the session isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.coach)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const body = await readBody<{ entries?: unknown }>(event)
  const roster = await markAttendance(membership.organization.id, id, body?.entries, membership.id, membership.id)
  if (!roster) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return { roster }
})
