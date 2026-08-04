import type { OrgRole } from '../../../../../../shared/permissions'

// Refund the latest payment on a student's subscription (full). MONEY-OUT, so
// **owner-only** (an admin must never move money back out) — like ownership transfer
// and Connect setup. A POST, so the subscription gate applies. Idempotent per invoice
// in the service, so a double-submit never double-refunds.
const OWNER_ONLY = ['owner'] as const satisfies readonly OrgRole[]

export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, OWNER_ONLY)

  const enrollmentId = getRouterParam(event, 'id')
  if (!enrollmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing enrolment id' })
  }

  return refundLatestPayment(membership.organization.id, enrollmentId, { memberId: membership.id, name: session.user.name })
})
