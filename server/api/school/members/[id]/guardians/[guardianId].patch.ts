import { AREA_ROLES } from '../../../../../../shared/permissions'

// Update one guardian contact (school roles only). The service re-checks
// reachability against the merged record and keeps the single-primary invariant.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const guardianId = getRouterParam(event, 'guardianId') as string

  const guardian = await updateMemberGuardian(membership.organization.id, guardianId, await readBody(event))
  if (!guardian) {
    throw createError({ statusCode: 404, statusMessage: 'Guardian not found', data: { code: 'GUARDIAN_NOT_FOUND' } })
  }

  return { guardian }
})
