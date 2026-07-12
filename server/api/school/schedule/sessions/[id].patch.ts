import { AREA_ROLES } from '../../../../../shared/permissions'

// Edits a single occurrence: `{ restore: true }` un-cancels it (re-checking the
// slot is free); otherwise reschedules/overrides it (new time/court/coach/…),
// re-validating conflicts. School roles only. 404 when not this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const orgId = membership.organization.id
  const session = body.restore === true
    ? await restoreLessonSession(orgId, id)
    : await updateLessonSession(orgId, id, body)

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  return { session }
})
