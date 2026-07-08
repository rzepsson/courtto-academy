import { AREA_ROLES } from '../../../shared/permissions'

export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  // Wrapped so a not-yet-generated code sends `{ joinCode: null }` rather than an
  // empty body (which trips useFetch's undefined-value warning on the client).
  return { joinCode: await getOrgJoinCode(membership.organization.id) }
})
