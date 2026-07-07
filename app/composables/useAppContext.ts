const APP_CONTEXT_KEY = 'app:context'

export function useAppContext() {
  return useFetch('/api/app-context', { key: APP_CONTEXT_KEY })
}

export function refreshAppContext() {
  return refreshNuxtData(APP_CONTEXT_KEY)
}

// Drop the cached context so the next read refetches. Must run on every auth
// transition (sign in/up/out): the cache is keyed globally, not per-user, so
// without this the previous user's memberships/roles leak into the next
// session in the same tab until a hard refresh.
export function clearAppContext() {
  return clearNuxtData(APP_CONTEXT_KEY)
}
