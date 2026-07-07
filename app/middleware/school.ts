export default defineNuxtRouteMiddleware(async () => {
  const target = await resolveAreaRedirect('school')

  if (target) {
    return navigateTo(target)
  }
})
