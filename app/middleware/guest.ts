export default defineNuxtRouteMiddleware(async (to) => {
  const { data: session } = await useAuthSession()

  if (session.value) {
    return navigateTo(sanitizeRedirect(to.query.redirect))
  }
})
