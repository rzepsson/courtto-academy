import { AREA_ROLES } from '../../../../../shared/permissions'

// Edit a series' structure (start, duration, recurrence), re-materializing future
// occurrences. Destructive to future single-occurrence changes by design (see
// updateSeriesSchedule). School roles only. 404 when not this facility's.
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

  const lesson = await updateSeriesSchedule(membership.organization.id, id, body)
  if (!lesson) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { lesson }
})
