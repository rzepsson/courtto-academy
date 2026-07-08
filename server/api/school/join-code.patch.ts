import { AREA_ROLES } from '../../../shared/permissions'

// Toggle self-enrollment on/off. Returns `{ joinCode: null }` if the school has
// no code yet (nothing to toggle) rather than erroring.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const { enabled } = await readBody<{ enabled?: boolean }>(event)

  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled must be a boolean' })
  }

  return { joinCode: await setOrgJoinCodeEnabled(membership.organization.id, enabled) }
})
