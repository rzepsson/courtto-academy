import { AREA_ROLES } from '../../../../../shared/permissions'

// Creates a court block (maintenance window / closure) — a standalone reservation
// that takes this court out of service for a wall-clock range. The service
// validates the body, resolves the range in the facility timezone, and rejects
// any overlap with existing lessons/blocks (the EXCLUDE is the race-safe
// backstop). School roles only.
export default defineEventHandler(async (event) => {
  const { membership, session } = await requireActiveMembership(event, AREA_ROLES.school)

  const courtId = getRouterParam(event, 'id')
  if (!courtId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const block = await createCourtBlock(membership.organization.id, courtId, body, session.user.id)
  return { block }
})
