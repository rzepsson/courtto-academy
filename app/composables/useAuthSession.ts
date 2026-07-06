const SESSION_KEY = 'auth:session'

export function useAuthSession() {
  return useFetch('/api/session', {
    key: SESSION_KEY,
    transform: data => data.session
  })
}

export function refreshAuthSession() {
  return refreshNuxtData(SESSION_KEY)
}
