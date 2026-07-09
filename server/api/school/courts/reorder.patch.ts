import { AREA_ROLES } from '../../../../shared/permissions'

// Persists a drag-reorder. The static `reorder` segment takes precedence over
// the dynamic `[id]` route in Nitro, so this never collides with PATCH /courts/[id].
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const body = await readBody<{ ids?: unknown }>(event)
  const ids = body?.ids
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'ids must be an array of strings' })
  }

  const courts = await reorderCourts(membership.organization.id, ids as string[])
  return { courts }
})
