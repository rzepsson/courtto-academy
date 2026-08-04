import { AREA_ROLES } from '../../../../shared/permissions'

// Update a plan (name / description / amount) or restore an archived one
// (`{ restore: true }`). School roles; a PATCH, so the subscription gate applies.
// An amount change creates a new immutable Stripe Price (existing subscriptions keep
// the old one — see the service).
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const planId = getRouterParam(event, 'id')
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing plan id' })
  }

  const body = await readBody(event)
  const plan = body?.restore === true
    ? await restorePricingPlan(membership.organization.id, planId)
    : await updatePricingPlan(membership.organization.id, planId, body)

  if (!plan) {
    throw createError({ statusCode: 404, statusMessage: 'Plan not found' })
  }
  return { plan }
})
