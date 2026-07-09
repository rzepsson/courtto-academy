import type { NotificationFeed } from '~~/server/database/types'

const NOTIFICATIONS_KEY = 'app:notifications'

// Client source of truth for the notification bell. Backed by the REST feed
// (authoritative); the WebSocket plugin only calls refreshNotifications() to pull
// fresh data on a server nudge. Mutations update the cache optimistically for a
// snappy bell, then reconcile against the server on failure.
export function useNotifications() {
  const { data, status, refresh } = useFetch<NotificationFeed>('/api/notifications', {
    key: NOTIFICATIONS_KEY,
    default: () => ({ notifications: [], unreadCount: 0 })
  })

  const notifications = computed(() => data.value?.notifications ?? [])
  const unreadCount = computed(() => data.value?.unreadCount ?? 0)
  const pending = computed(() => status.value === 'pending')

  async function markAllRead() {
    if (!data.value || data.value.unreadCount === 0) {
      return
    }
    data.value = {
      notifications: data.value.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0
    }
    try {
      await $fetch('/api/notifications/read', { method: 'POST' })
    } catch {
      await refresh()
    }
  }

  async function dismiss(id: string) {
    if (!data.value) {
      return
    }
    const target = data.value.notifications.find(n => n.id === id)
    if (!target || !target.dismissible) {
      return
    }
    data.value = {
      notifications: data.value.notifications.filter(n => n.id !== id),
      unreadCount: target.read ? data.value.unreadCount : Math.max(0, data.value.unreadCount - 1)
    }
    try {
      await $fetch(`/api/notifications/${id}`, { method: 'DELETE' })
    } catch {
      await refresh()
    }
  }

  async function clearAll() {
    if (!data.value) {
      return
    }
    const remaining = data.value.notifications.filter(n => !n.dismissible)
    data.value = {
      notifications: remaining,
      unreadCount: remaining.filter(n => !n.read).length
    }
    try {
      await $fetch('/api/notifications', { method: 'DELETE' })
    } catch {
      await refresh()
    }
  }

  return { notifications, unreadCount, pending, refresh, markAllRead, dismiss, clearAll }
}

export function refreshNotifications() {
  return refreshNuxtData(NOTIFICATIONS_KEY)
}

// Drop the cached feed on auth transitions — the cache is keyed globally, so
// without this the previous user's notifications leak into the next session in
// the same tab (mirrors clearAppContext).
export function clearNotificationsCache() {
  return clearNuxtData(NOTIFICATIONS_KEY)
}
