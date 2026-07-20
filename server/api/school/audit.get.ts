import { AREA_ROLES } from '../../../shared/permissions'

// The org-wide governance audit feed (school roles only). Keyset-paginated: pass
// the previous response's `nextCursor` to load older entries.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const query = getQuery(event)

  const limit = Number(query.limit)
  return listOrgAudit(membership.organization.id, {
    cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined
  })
})
