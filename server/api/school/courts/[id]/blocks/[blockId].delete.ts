import { AREA_ROLES } from '../../../../../../shared/permissions'

// Permanently removes a court block (maintenance window / closure). The service
// is constrained to block kinds and refuses rows a lesson session points at, so
// it can never delete a lesson's reservation. Scoped to the caller's facility.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const blockId = getRouterParam(event, 'blockId')
  if (!blockId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing block id' })
  }

  const removed = await deleteCourtBlock(membership.organization.id, blockId)
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: 'Block not found' })
  }

  return { ok: true }
})
