// In-process registry of authenticated WebSocket peers, keyed by user id. The
// notifications service publishes to a user here after writing a row, so the
// bell updates live without polling.
//
// Deliberately a plain module-level singleton (like `db`/`auth`): it holds only
// connection state for THIS Nitro process. That's correct for a single instance;
// horizontally scaling to multiple instances means a peer connected to instance
// A won't receive a publish that happens on instance B. The documented scaling
// path is to back this with a Redis (or Postgres LISTEN/NOTIFY) pub/sub fan-out
// — the publish/subscribe surface here (`publishToUser`) is the single seam that
// would change. Realtime is an enhancement, never the source of truth: the
// client always reloads the feed over REST, so a missed publish self-heals on
// the next fetch.

// Structural type — avoids a hard dependency on crossws' exported types while
// still capturing what we use. Peers are tracked by reference identity.
interface RealtimePeer {
  send: (data: string) => void
}

export interface RealtimeMessage {
  event: 'notification'
}

const peersByUser = new Map<string, Set<RealtimePeer>>()
const userByPeer = new WeakMap<RealtimePeer, string>()

export function registerPeer(userId: string, peer: RealtimePeer): void {
  let set = peersByUser.get(userId)
  if (!set) {
    set = new Set()
    peersByUser.set(userId, set)
  }
  set.add(peer)
  userByPeer.set(peer, userId)
}

export function unregisterPeer(peer: RealtimePeer): void {
  const userId = userByPeer.get(peer)
  if (!userId) {
    return
  }
  userByPeer.delete(peer)
  const set = peersByUser.get(userId)
  if (set) {
    set.delete(peer)
    if (set.size === 0) {
      peersByUser.delete(userId)
    }
  }
}

export function publishToUser(userId: string, message: RealtimeMessage): void {
  const set = peersByUser.get(userId)
  if (!set) {
    return
  }
  const payload = JSON.stringify(message)
  for (const peer of set) {
    try {
      peer.send(payload)
    } catch {
      // A dead peer that hasn't fired `close` yet — drop it so we don't retry.
      unregisterPeer(peer)
    }
  }
}
