// Live notification channel. Opens the Nitro WebSocket while a session is active
// and calls refreshNotifications() on each server nudge so the bell updates
// without polling. The socket is a pure enhancement: the REST feed is
// authoritative, so a dropped connection degrades to fetch-on-load and the
// reconnect/backoff below quietly restores live updates.
export default defineNuxtPlugin(() => {
  const { data: session } = useAuthSession()

  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let attempts = 0
  let intentionalClose = false

  function endpoint() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/api/notifications/ws`
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    intentionalClose = false
    socket = new WebSocket(endpoint())

    socket.onopen = () => {
      attempts = 0
      pingTimer = setInterval(() => socket?.send('ping'), 30_000)
    }

    socket.onmessage = (event) => {
      if (event.data === 'pong') {
        return
      }
      refreshNotifications()
    }

    socket.onclose = (event) => {
      clearPing()
      socket = null
      // 4401 = server rejected an unauthenticated peer; don't hammer it. A real
      // sign-in re-triggers the session watcher below, which reconnects.
      if (intentionalClose || event.code === 4401) {
        return
      }
      scheduleReconnect()
    }

    socket.onerror = () => socket?.close()
  }

  function scheduleReconnect() {
    if (reconnectTimer) {
      return
    }
    const delay = Math.min(30_000, 1_000 * 2 ** attempts) + Math.random() * 500
    attempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function clearPing() {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function disconnect() {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    clearPing()
    socket?.close()
    socket = null
    attempts = 0
  }

  // Open/close the socket with the session lifecycle (sign in ↔ sign out).
  watch(() => session.value?.user?.id, (userId) => {
    if (userId) {
      connect()
    } else {
      disconnect()
    }
  }, { immediate: true })

  // A backgrounded tab often has its socket reaped; reconnect on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session.value?.user?.id && !socket) {
      connect()
    }
  })
})
