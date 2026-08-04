import { AREA_ROLES } from '../../../../../../shared/permissions'

// Open a Stripe Customer Portal session for one enrolment's payer (manage card /
// cancel), on the connected account. School roles; a POST, so the subscription gate
// applies. Returns the URL for the client to redirect to.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const enrollmentId = getRouterParam(event, 'id')
  if (!enrollmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing enrolment id' })
  }

  const origin = getRequestURL(event).origin
  return createBillingPortalSession(membership.organization.id, enrollmentId, `${origin}/school/schedule`)
})
