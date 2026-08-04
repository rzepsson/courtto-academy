import { AREA_ROLES } from '../../../../../../shared/permissions'

// Create a Stripe Checkout link for a student's enrolment in a priced group and
// email it to the payer (guardian, or the adult student). Returns the URL too, so
// staff can copy it if mail bounces. School roles; a POST, so the subscription gate
// applies. The service enforces the connected account is ready + resolves the payer.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const enrollmentId = getRouterParam(event, 'id')
  if (!enrollmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing enrolment id' })
  }

  const origin = getRequestURL(event).origin
  return createCheckoutForEnrollment(
    membership.organization.id,
    enrollmentId,
    { successUrl: `${origin}/pay/success`, cancelUrl: `${origin}/pay/cancel` },
    { memberId: membership.id, name: session.user.name }
  )
})
