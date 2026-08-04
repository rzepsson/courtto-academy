import { AREA_ROLES } from '../../../../shared/permissions'

// The school's payment-collection status (Connect onboarding state + whether it can
// charge yet + whether the platform is configured at all). School roles may read
// it; the mutating onboarding action is owner-gated. A GET, so the subscription
// gate never blocks it. Refreshes the mirror from Stripe on read (see the service).
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  return { account: await getPaymentAccount(membership.organization.id) }
})
