export default defineNuxtRouteMiddleware(async () => {
  const target = await resolveAreaRedirect('coach')

  if (target) {
    return navigateTo(target)
  }
})
