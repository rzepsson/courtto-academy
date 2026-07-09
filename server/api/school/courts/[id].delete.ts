import { AREA_ROLES } from '../../../../shared/permissions'

// Default: soft-delete (archive) — the row is retained so historical schedule/
// booking references stay valid, but it leaves the active roster. With `?purge=1`
// it is instead permanently deleted (irreversible; the UI guards it with a
// warning). Both are scoped to the caller's facility.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const query = getQuery(event)
  const purge = query.purge === '1' || query.purge === 'true'
  const orgId = membership.organization.id

  const court = purge ? await deleteCourt(orgId, id) : await archiveCourt(orgId, id)
  if (!court) {
    throw createError({ statusCode: 404, statusMessage: 'Court not found' })
  }

  return { court }
})
