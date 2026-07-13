import { AREA_ROLES } from '../../../../../../shared/permissions'

// Remove a slot: deletes its future occurrences (frees the court), keeps its past
// as history. Can't remove the only slot. School roles only. 404 when the series
// or rule isn't this facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  const ruleId = getRouterParam(event, 'ruleId')
  if (!id || !ruleId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson or slot id' })
  }

  const lesson = await removeSeriesRule(membership.organization.id, id, ruleId)
  if (!lesson) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson or slot not found' })
  }

  return { lesson }
})
