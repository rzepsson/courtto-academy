import { AREA_ROLES } from '../../../../shared/permissions'

// Creates a court. The service validates the body (sport ⊂ facility offer,
// surface valid for sport, colours, enums) and appends it to the roster.
export default defineEventHandler(async (event) => {
  const { membership, session } = await requireActiveMembership(event, AREA_ROLES.school)

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const court = await createCourt(membership.organization.id, body, session.user.id)
  return { court }
})
