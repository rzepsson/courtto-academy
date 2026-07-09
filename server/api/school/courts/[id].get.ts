import { AREA_ROLES } from '../../../../shared/permissions'

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing court id' })
  }

  const court = await getCourt(membership.organization.id, id)
  if (!court) {
    throw createError({ statusCode: 404, statusMessage: 'Court not found' })
  }

  return { court }
})
