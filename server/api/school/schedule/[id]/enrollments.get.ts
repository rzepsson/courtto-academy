import { AREA_ROLES } from '../../../../../shared/permissions'

// The full enrolment list for a series (enrolled + waitlisted, in queue order),
// with student display fields. School roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson id' })
  }

  const enrollments = await listSeriesEnrollments(membership.organization.id, id)
  return { enrollments }
})
