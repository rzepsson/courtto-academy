import { AREA_ROLES } from '../../../../../../shared/permissions'

// Remove a guardian contact (school roles only). If it was the primary, the
// service promotes the longest-standing survivor so the member is never left with
// contacts but nobody to call first.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const guardianId = getRouterParam(event, 'guardianId') as string

  const guardian = await deleteMemberGuardian(membership.organization.id, guardianId)
  if (!guardian) {
    throw createError({ statusCode: 404, statusMessage: 'Guardian not found', data: { code: 'GUARDIAN_NOT_FOUND' } })
  }

  return { ok: true }
})
