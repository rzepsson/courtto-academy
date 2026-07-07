import { roleArea } from '~~/shared/permissions'
import type { Area } from '~~/shared/permissions'

// Returns the redirect target for a role-area middleware, or null to allow.
// Compares the member's home area rather than an allowlist so an unknown/legacy
// role (which roleArea maps to 'my') always resolves somewhere reachable instead
// of bouncing between two guards that both reject it.
//
// navigateTo must be called from the middleware file itself: Nuxt's async
// context transform only covers middleware/plugins, not utils, so calling it
// here after an await would throw "composable called outside Nuxt instance".
export async function resolveAreaRedirect(area: Area): Promise<string | null> {
  const { data: context } = await useAppContext()
  const active = activeMembershipOf(context.value)

  if (!active) {
    return '/onboarding'
  }

  return roleArea(active.role) === area ? null : roleHome(active.role)
}
