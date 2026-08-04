import { AREA_ROLES } from '../../../../shared/permissions'

// Archive a plan (soft-delete — deactivates the Stripe Product/Price but existing
// subscriptions continue). School roles; a DELETE, so the subscription gate applies.
// Reversible via PATCH { restore: true }.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const planId = getRouterParam(event, 'id')
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing plan id' })
  }

  const plan = await archivePricingPlan(membership.organization.id, planId)
  if (!plan) {
    throw createError({ statusCode: 404, statusMessage: 'Plan not found' })
  }
  return { plan }
})
