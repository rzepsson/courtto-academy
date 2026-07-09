import { AREA_ROLES } from '../../../shared/permissions'
import { computeProfileCompletion } from '../../../shared/org-profile'

// Partial update of the extended school profile. Each settings section PATCHes
// only its own fields; the body is validated + normalized before it touches the
// DB. `org_profile` is an app-owned table, so the service writes it directly.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const patch = await readValidatedBody(event, normalizeOrgProfilePatch)
  const profile = await upsertOrgProfile(membership.organization.id, patch)

  // Readiness is derived, so recompute against the full saved profile and let it
  // drive the setup-notification lifecycle: once the essentials are in place, the
  // non-dismissible "complete your school data" notification is resolved.
  if (computeProfileCompletion(profile).complete) {
    await resolveOrgSetupNotification(membership.organization.id)
  }

  return { profile }
})
