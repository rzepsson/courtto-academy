import { AREA_ROLES } from '../../../../shared/permissions'

// Deletes a zone. Its courts are ungrouped (FK set null), never removed. Scoped
// to the caller's facility; 404 when the id isn't theirs.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing zone id' })
  }

  const removed = await deleteZone(membership.organization.id, id)
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: 'Zone not found' })
  }

  return { ok: true }
})
