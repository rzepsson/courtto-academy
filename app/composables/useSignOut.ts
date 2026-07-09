// Single source for the sign-out transition, shared by the dashboard user menu
// and the onboarding/auth screens. Follows the auth-transition rules: clear the
// globally-keyed app-context cache and refresh the session before redirecting,
// so middleware never reads a stale session or leaks the previous user's
// memberships into the next session in the same tab.
export function useSignOut() {
  const signingOut = ref(false)

  async function signOut() {
    if (signingOut.value) {
      return
    }

    signingOut.value = true
    try {
      await authClient.signOut()
      clearAppContext()
      clearNotificationsCache()
      await refreshAuthSession()
      await navigateTo('/login')
    } finally {
      signingOut.value = false
    }
  }

  return { signingOut, signOut }
}
