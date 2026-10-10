import { applyPatch, isEmptyPatch, mergePatches } from './patch'
import type { Patch } from './patch'
import type { ClientMessage, PeerInfo, PeerPresence, ServerMessage } from './protocol'
import type { BoardElement, Point } from './types'

export type SyncStatus = 'connecting' | 'online' | 'offline' | 'deleted' | 'locked'

interface PendingOp {
  opId: number
  patch: Patch
  sent: boolean
}

export interface SyncHandlers {
  /** The board as this client should show it (server state + own unacknowledged edits). */
  onState(elements: BoardElement[], initial: boolean): void
  onStatus(status: SyncStatus): void
  onPeers(peers: PeerPresence[]): void
  onError(message: string): void
  /** An administrator deleted the board. The client has stopped syncing for good. */
  onDeleted?(): void
  /** The server wants an access key (none or a wrong one was sent). Syncing pauses until `unlock`. */
  onUnauthorized?(): void
}

const FLUSH_MS = 30
const PRESENCE_MS = 50

/**
 * Keeps one board in sync with the server.
 *
 * `confirmed` mirrors the server's state: every op the server relays is
 * applied to it in server order. Local edits are applied optimistically and
 * queued in `pending` until the server echoes them back. What the user sees is
 * always `confirmed` + `pending`, so all clients converge on the server's order
 * even when two people edit the same element at once.
 */
export class SyncClient {
  private ws: WebSocket | null = null
  private confirmed: BoardElement[] = []
  private pending: PendingOp[] = []
  private nextOpId = 1
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private presenceTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retries = 0
  private closed = false
  /** Refused for a missing or wrong access key: don't reconnect until `unlock`. */
  private locked = false
  private ready = false
  private peers = new Map<string, PeerPresence>()
  private presence: { cursor: Point | null; selection: string[]; name: string; color: string }
  private presenceDirty = false

  constructor(
    private readonly board: string,
    private readonly me: PeerInfo,
    private readonly handlers: SyncHandlers,
    private key = '',
  ) {
    this.presence = { cursor: null, selection: [], name: me.name, color: me.color }
    this.connect()
  }

  /** Queue a local change for the server. Consecutive unsent changes are merged. */
  local(patch: Patch) {
    if (isEmptyPatch(patch)) return
    const last = this.pending[this.pending.length - 1]
    if (last && !last.sent) last.patch = mergePatches(last.patch, patch)
    else this.pending.push({ opId: this.nextOpId++, patch, sent: false })
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  /** Share cursor position, selection and display name with others (throttled). */
  setPresence(cursor: Point | null, selection: string[], identity: { name: string; color: string }) {
    this.presence = { cursor, selection, name: identity.name, color: identity.color }
    this.presenceDirty = true
    this.presenceTimer ??= setTimeout(() => this.sendPresence(), PRESENCE_MS)
  }

  /** Try again with an access key after `onUnauthorized`. */
  unlock(key: string) {
    this.key = key
    if (this.closed || !this.locked) return // otherwise the next (re)connect uses the new key
    // The refused socket may not have finished closing yet; drop it.
    const old = this.ws
    this.ws = null
    old?.close()
    this.retries = 0
    this.connect()
  }

  close() {
    this.closed = true
    for (const t of [this.flushTimer, this.presenceTimer, this.reconnectTimer]) if (t) clearTimeout(t)
    this.ws?.close()
  }

  private connect() {
    this.handlers.onStatus('connecting')
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/ws?board=${encodeURIComponent(this.board)}`)
    this.ws = ws
    this.locked = false
    ws.onopen = () => this.send({ type: 'hello', ...this.me, ...(this.key ? { key: this.key } : {}) })
    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      this.receive(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.ready = false
      this.peers.clear()
      this.handlers.onPeers([])
      if (this.closed || this.locked) return
      this.handlers.onStatus('offline')
      // Reconnect with backoff; edits made meanwhile stay pending and are sent after.
      const delay = Math.min(10_000, 500 * 2 ** this.retries++)
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }
  }

  private receive(msg: ServerMessage) {
    switch (msg.type) {
      case 'init': {
        this.retries = 0
        this.ready = true
        this.confirmed = msg.elements
        // Anything not acknowledged before a disconnect is resent as one op.
        // Re-applying an op the server already had is harmless: upserts and deletes are idempotent.
        if (this.pending.length) {
          const merged = this.pending.reduce<Patch>((acc, op) => mergePatches(acc, op.patch), { upserts: [], deletes: [] })
          this.pending = [{ opId: this.nextOpId++, patch: merged, sent: false }]
          this.flush()
        }
        this.peers = new Map(msg.peers.map((p) => [p.clientId, p]))
        this.handlers.onPeers([...this.peers.values()])
        this.handlers.onStatus('online')
        this.handlers.onState(this.view(), true)
        this.sendPresence()
        break
      }
      case 'op': {
        this.confirmed = applyPatch(this.confirmed, msg.patch)
        if (msg.clientId === this.me.clientId) {
          // Our own op coming back: it's now part of `confirmed`.
          this.pending = this.pending.filter((op) => op.opId !== msg.opId)
        } else {
          this.handlers.onState(this.view(), false)
        }
        break
      }
      case 'presence':
        this.peers.set(msg.peer.clientId, msg.peer)
        this.handlers.onPeers([...this.peers.values()])
        break
      case 'leave':
        this.peers.delete(msg.clientId)
        this.handlers.onPeers([...this.peers.values()])
        break
      case 'error':
        this.handlers.onError(msg.message)
        break
      case 'unauthorized':
        // Retrying with the same key would just be refused again; edits made meanwhile stay pending.
        this.locked = true
        this.handlers.onStatus('locked')
        this.handlers.onUnauthorized?.()
        break
      case 'deleted':
        // Stop for good: reconnecting (or resending pending edits) would recreate the board.
        this.closed = true
        this.pending = []
        for (const t of [this.flushTimer, this.presenceTimer, this.reconnectTimer]) if (t) clearTimeout(t)
        this.flushTimer = this.presenceTimer = this.reconnectTimer = null
        this.ws?.close()
        this.peers.clear()
        this.handlers.onPeers([])
        this.handlers.onStatus('deleted')
        this.handlers.onDeleted?.()
        break
    }
  }

  private view(): BoardElement[] {
    return this.pending.reduce((els, op) => applyPatch(els, op.patch), this.confirmed)
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (!this.ready) return // sent after (re)connecting
    for (const op of this.pending) {
      if (op.sent) continue
      this.send({ type: 'op', opId: op.opId, patch: op.patch })
      op.sent = true
    }
  }

  private sendPresence() {
    if (this.presenceTimer) clearTimeout(this.presenceTimer)
    this.presenceTimer = null
    if (!this.ready || !this.presenceDirty) return
    this.presenceDirty = false
    this.send({ type: 'presence', ...this.presence })
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }
}
