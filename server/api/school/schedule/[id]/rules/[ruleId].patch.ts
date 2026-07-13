import { AREA_ROLES } from '../../../../../../shared/permissions'

// Edit a slot, re-materializing its future occurrences (see updateSeriesRule).
// Body = a single rule. School roles only. 404 when the series or rule isn't this
// facility's.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  const ruleId = getRouterParam(event, 'ruleId')
  if (!id || !ruleId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson or slot id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const lesson = await updateSeriesRule(membership.organization.id, id, ruleId, body)
  if (!lesson) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson or slot not found' })
  }

  return { lesson }
})
