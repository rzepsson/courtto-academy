import { AREA_ROLES } from '../../../shared/permissions'

// Partial update of the extended school profile. Each settings section PATCHes
// only its own fields; the body is validated + normalized before it touches the
// DB. `org_profile` is an app-owned table, so the service writes it directly.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const body = await readBody<Record<string, unknown>>(event)

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected an object body' })
  }

  const patch = normalizeOrgProfilePatch(body)
  return { profile: await upsertOrgProfile(membership.organization.id, patch) }
})
