import { AREA_ROLES } from '../../../../../shared/permissions'

// The series' capacity context + its full enrolment list (enrolled + waitlisted,
// in queue order) with student display fields — the staff enrolment panel feed.
// School roles only. 404 when the series isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson id' })
  }

  const orgId = membership.organization.id
  const series = await getSeriesEnrollmentSummary(orgId, id)
  if (!series) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found', data: { code: 'SCHEDULE_NOT_FOUND' } })
  }

  const [enrollments, billing, billingContext] = await Promise.all([
    listSeriesEnrollments(orgId, id),
    listSeriesEnrollmentBilling(orgId, id),
    getSeriesBillingContext(orgId, id)
  ])
  return { series, enrollments, billing, billingContext }
})
