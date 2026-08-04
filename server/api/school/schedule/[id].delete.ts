import { AREA_ROLES } from '../../../../shared/permissions'

// Default: cancel the series (soft — sessions + reservations flip to cancelled,
// freeing the courts; history is retained). With `?purge=1` it is permanently
// deleted (irreversible; cascades to sessions and their reservations). Optional
// `?reason=` annotates a cancellation. School roles only.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing lesson id' })
  }

  const query = getQuery(event)
  const orgId = membership.organization.id
  const actor = { memberId: membership.id, name: session.user.name }

  if (query.purge === '1' || query.purge === 'true') {
    const purged = await purgeSeries(orgId, id, actor)
    if (!purged) {
      throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
    }
    return { purged: true }
  }

  const reason = typeof query.reason === 'string' ? query.reason : undefined
  const lesson = await cancelSeries(orgId, id, reason, actor)
  if (!lesson) {
    throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  }

  return { lesson }
})
