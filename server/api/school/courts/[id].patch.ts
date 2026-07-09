import { AREA_ROLES } from '../../../../shared/permissions'

// Updates a court, or restores an archived one when the body is `{ restore: true }`
// (restore toggles the lifecycle flag; a normal PATCH updates writable fields).
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const orgId = membership.organization.id
  const court = body.restore === true
    ? await restoreCourt(orgId, id)
    : await updateCourt(orgId, id, body)

  if (!court) {
    throw createError({ statusCode: 404, statusMessage: 'Court not found' })
  }

  return { court }
})
