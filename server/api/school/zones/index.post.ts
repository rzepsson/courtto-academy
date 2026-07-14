import { AREA_ROLES } from '../../../../shared/permissions'

// Creates a zone (name unique per facility; appended to the end of the order).
export default defineEventHandler(async (event) => {
  const { membership, session } = await requireActiveMembership(event, AREA_ROLES.school)

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const zone = await createZone(membership.organization.id, body, session.user.id)
  return { zone }
})
