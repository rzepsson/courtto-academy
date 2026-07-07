const APP_CONTEXT_KEY = 'app:context'

export function useAppContext() {
  return useFetch('/api/app-context', { key: APP_CONTEXT_KEY })
}

export function refreshAppContext() {
  return refreshNuxtData(APP_CONTEXT_KEY)
}
