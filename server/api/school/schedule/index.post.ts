import { AREA_ROLES } from '../../../../shared/permissions'

// Creates a lesson (a series + its materialized sessions + core reservations).
// The service validates the body (shared Zod schema + context rules: sport
// offered, court/coach resolve, capacity) and guarantees no court double-booking
// (pre-check + EXCLUDE). School roles only.
export default defineEventHandler(async (event) => {
  const { membership, session } = await requireActiveMembership(event, AREA_ROLES.school)

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const lesson = await createLesson(membership.organization.id, body, session.user.id)
  return { lesson }
})
