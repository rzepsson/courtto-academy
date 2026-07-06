const SESSION_KEY = 'auth:session'

export function useAuthSession() {
  return useFetch('/api/session', { key: SESSION_KEY })
}

export function refreshAuthSession() {
  return refreshNuxtData(SESSION_KEY)
}
