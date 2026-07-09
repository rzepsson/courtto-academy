// Live notification channel (Nitro built-in WebSocket, crossws under the hood).
// The peer is authenticated once on connect from its session cookie and then
// registered by user id; the notifications service publishes here after writing
// a row. This is a one-way nudge — the client reloads the feed over REST on any
// message — so the socket never carries authoritative state or trust decisions.
export default defineWebSocketHandler({
  async open(peer) {
    const session = await auth.api.getSession({ headers: peer.request?.headers ?? new Headers() })
    if (!session) {
      // 4401: application-level "unauthorized" close code.
      peer.close(4401, 'Unauthorized')
      return
    }
    registerPeer(session.user.id, peer)
  },

  message(peer, message) {
    // Lightweight keepalive so intermediaries don't reap an idle connection.
    if (message.text() === 'ping') {
      peer.send('pong')
    }
  },

  close(peer) {
    unregisterPeer(peer)
  },

  error(peer) {
    unregisterPeer(peer)
  }
})
