import { AREA_ROLES } from '../../../../shared/permissions'
import { parseMemberDirectoryQuery } from '../../../../shared/member-profile'

// CSV export of the member directory (school roles only), honoring the same
// filters/sort as the on-screen table but unpaginated. Column headers are stable
// machine keys (a data file, not UI chrome) so the export is diff-friendly and
// import-safe regardless of the viewer's locale.
const CSV_HEADERS = ['name', 'email', 'role', 'status', 'can_coach', 'tags', 'joined']

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const query = parseMemberDirectoryQuery(getQuery(event))
  const rows = await listMembersForExport(membership.organization.id, query)

  const csv = buildCsv(
    CSV_HEADERS,
    rows.map(row => [
      row.user.name,
      row.user.email,
      row.role,
      row.status,
      row.canCoach ? 'yes' : 'no',
      row.tags.join('; '),
      row.createdAt.toISOString()
    ])
  )

  const stamp = new Date().toISOString().slice(0, 10)
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="members-${stamp}.csv"`)
  return csv
})
