import { AREA_ROLES } from '../../../shared/permissions'

// The school's billing status for the /school/billing page: entitlement (status +
// trial days left), the current subscription summary (null while on the app trial),
// and whether Stripe is configured (unset env → the UI shows a "billing not
// configured" notice instead of a broken subscribe button). School roles may read
// it; the mutating actions (checkout/portal) are owner-gated by the Stripe plugin's
// authorizeReference. A GET, so the subscription gate never blocks it.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const billing = await getOrgBilling(membership.organization.id)
  return { ...billing, configured: isBillingConfigured() }
})
