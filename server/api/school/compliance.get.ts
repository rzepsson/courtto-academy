import { AREA_ROLES } from '../../../shared/permissions'

// The roster-level RODO/GDPR compliance report (students missing a guardian or an
// image consent) + summary counts. School roles only — this is PII. A GET, so the
// subscription gate never blocks it.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  return { report: await getComplianceReport(membership.organization.id) }
})
