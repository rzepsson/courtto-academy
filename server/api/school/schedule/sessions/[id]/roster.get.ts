import { AREA_ROLES } from '../../../../../../shared/permissions'

// The attendance roster for a session (enrolled attendees + their marked
// attendance). School roles only. 404 when the session isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const roster = await getSessionRoster(membership.organization.id, id)
  if (!roster) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return { roster }
})
