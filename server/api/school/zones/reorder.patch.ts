import { AREA_ROLES } from '../../../../shared/permissions'

// Persists a zone drag-reorder. The static `reorder` route wins over `[id]` in
// Nitro. School roles only.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const body = await readBody<{ ids?: unknown }>(event)
  const ids = body?.ids
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { ids: string[] }' })
  }

  const zones = await reorderZones(membership.organization.id, ids as string[])
  return { zones }
})
