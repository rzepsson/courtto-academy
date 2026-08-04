import type { OrgRole } from '../../../../shared/permissions'

// Start (or resume) Stripe Connect onboarding for the school and return a fresh
// Stripe-hosted onboarding link to redirect to. **Owner-only** (like ownership
// transfer + subscription billing — money is never an admin's to set up). A POST,
// so the subscription gate applies: a school without an active Courtto subscription
// can't set up fee collection (consistent with "requires active subscription").
const OWNER_ONLY = ['owner'] as const satisfies readonly OrgRole[]

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, OWNER_ONLY)

  if (!isPaymentsConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Payments not configured', data: { code: 'PAYMENTS_NOT_CONFIGURED' } })
  }

  const origin = getRequestURL(event).origin
  return startOnboarding(membership.organization.id, {
    returnUrl: `${origin}/school/payments?onboarding=return`,
    refreshUrl: `${origin}/school/payments?onboarding=refresh`
  })
})
