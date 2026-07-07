export default defineNuxtRouteMiddleware(async () => {
  const target = await resolveAreaRedirect('my')

  if (target) {
    return navigateTo(target)
  }
})
