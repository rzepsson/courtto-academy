import { AREA_ROLES } from '../../../../../shared/permissions'

// Reassigns a series' lead coach and/or default court, propagating to future
// non-overridden sessions with a conflict re-check. School roles only. 404 when
// not this facility's.
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

  const lesson = await updateSeriesAssignment(membership.organization.id, id, body)
  if (!lesson) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { lesson }
})
