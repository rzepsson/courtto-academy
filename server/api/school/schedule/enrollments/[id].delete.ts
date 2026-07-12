import { AREA_ROLES } from '../../../../../shared/permissions'

// Cancel an enrolment (staff); promotes the first waitlisted student in the same
// scope. School roles only. 404 when the id isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing enrolment id' })
  }

  const result = await cancelEnrollment(membership.organization.id, id)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Enrolment not found' })
  }

  return { enrollment: result }
})
