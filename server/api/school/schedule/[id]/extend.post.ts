import { AREA_ROLES } from '../../../../../shared/permissions'

// Rolls a recurring series' materialization horizon forward, creating the newly
// in-range occurrences (skipping conflicts). Returns { created, skipped,
// materializedUntil }. School roles only. 404 when not this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson id' })
  }

  const result = await extendMaterialization(membership.organization.id, id)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { result }
})
