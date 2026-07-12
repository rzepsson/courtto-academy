import { AREA_ROLES } from '../../../../shared/permissions'

// Cancel the signed-in student's OWN enrolment (someone else's is treated as not
// found). Promotes the first waitlisted student in the same scope. Student only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.my)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing enrolment id' })
  }

  const result = await cancelEnrollment(membership.organization.id, id, membership.id)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Enrolment not found' })
  }

  return { enrollment: result }
})
