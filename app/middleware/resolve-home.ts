// `/dashboard` is a pure router: it always redirects to the area matching the
// user's role in the active school, or to onboarding when they have none.
export default defineNuxtRouteMiddleware(async () => {
  const { data: context } = await useAppContext()
  const active = activeMembershipOf(context.value)

  if (!active) {
    return navigateTo('/onboarding', { replace: true })
  }

  if (active.status !== 'active') {
    return navigateTo('/access-paused', { replace: true })
  }

  if (context.value?.entitlement && !context.value.entitlement.entitled) {
    return navigateTo('/billing-required', { replace: true })
  }

  return navigateTo(roleHome(active.role), { replace: true })
})
