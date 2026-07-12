import { AREA_ROLES } from '../../../../shared/permissions'

// Updates series metadata (title, colour, capacity, enrolment policy, …). The
// service rejects structural edits (time/court/coach/recurrence) by only
// accepting metadata keys. School roles only. 404 when not this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const lesson = await updateSeriesMetadata(membership.organization.id, id, body)
  if (!lesson) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { lesson }
})
