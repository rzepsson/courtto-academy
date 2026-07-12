import { AREA_ROLES } from '../../../../../shared/permissions'

// Enrol a student in a series (staff). Body: { studentMemberId }. Enrolled or
// waitlisted depending on capacity. School roles only. 404 when not this org's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (typeof body?.studentMemberId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing studentMemberId' })
  }

  const result = await enrollInSeries(membership.organization.id, id, body.studentMemberId)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { enrollment: result }
})
