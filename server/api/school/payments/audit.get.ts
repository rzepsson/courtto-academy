import { AREA_ROLES } from '../../../../shared/permissions'

// The school's recent money-movement audit trail (who sent a link / cancelled /
// refunded). School roles; a GET, so the subscription gate never blocks it.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  return { entries: await listPaymentAudit(membership.organization.id) }
})
