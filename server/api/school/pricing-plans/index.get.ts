import { AREA_ROLES } from '../../../../shared/permissions'
import { REGIONAL_FALLBACK } from '../../../../shared/regional'

// The school's pricing plans (monthly group-membership prices) + the school's
// currency (authoritative for the create form's amount field). School roles; a GET,
// so the subscription gate never blocks it. `?includeArchived=1` includes
// soft-deleted plans (for the manage view).
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const includeArchived = getQuery(event).includeArchived === '1'

  const [plans, profile] = await Promise.all([
    listPricingPlans(membership.organization.id, { includeArchived }),
    getOrgProfile(membership.organization.id)
  ])

  return { plans, currency: (profile.currency || REGIONAL_FALLBACK.currency).toUpperCase() }
})
