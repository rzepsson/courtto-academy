import { AREA_ROLES } from '../../../../shared/permissions'

// Create a pricing plan (mirrors it as a Stripe Product + recurring Price on the
// school's connected account). School roles; a POST, so the subscription gate
// applies. The service requires a connected account first (PAYMENTS_ACCOUNT_REQUIRED).
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const body = await readBody(event)
  return { plan: await createPricingPlan(membership.organization.id, body, session.user.id) }
})
