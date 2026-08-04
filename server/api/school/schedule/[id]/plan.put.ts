import { AREA_ROLES } from '../../../../../shared/permissions'

// Assign (or clear) the monthly pricing plan a group is billed under. School roles;
// a PUT, so the subscription gate applies. `{ pricingPlanId: null }` clears it (free
// group). The service validates the plan belongs to the org and is active.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const seriesId = getRouterParam(event, 'id')
  if (!seriesId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing group id' })
  }

  const body = await readBody(event)
  const planId = typeof body?.pricingPlanId === 'string' && body.pricingPlanId ? body.pricingPlanId : null

  await setSeriesPlan(membership.organization.id, seriesId, planId)
  return { ok: true }
})
