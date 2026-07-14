import { AREA_ROLES } from '../../../../shared/permissions'

// Renames a zone. Scoped to the caller's facility; 404 when the id isn't theirs.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing zone id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const zone = await updateZone(membership.organization.id, id, body)
  if (!zone) {
    throw createError({ statusCode: 404, statusMessage: 'Zone not found' })
  }

  return { zone }
})
