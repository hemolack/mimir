import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { applyPatch } from '../src/patch.ts'
import type { Patch } from '../src/patch.ts'
import { BOARD_ID_PATTERN } from '../src/protocol.ts'
import type { ClientMessage, PeerPresence, ServerMessage } from '../src/protocol.ts'
import { sanitizeElements } from '../src/storage.ts'
import type { BoardElement } from '../src/types.ts'

const MAX_ELEMENTS = 50_000
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024
const SAVE_DELAY_MS = 1000

interface Room {
  id: string
  elements: BoardElement[]
  /** Every connected socket, including ones that haven't said hello yet. */
  sockets: Set<WebSocket>
  /** Sockets that have said hello, with their presence. */
  peers: Map<WebSocket, PeerPresence>
  saveTimer: NodeJS.Timeout | null
  /** Set when an administrator deletes the board: never save it again. */
  deleted: boolean
}

export interface BoardServer {
  /** Handle an HTTP upgrade if it is for /ws; returns false to let others handle it. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean
  /** Save all rooms and disconnect everyone. */
  close(): Promise<void>
  /**
   * Handle the board API; returns false for any other request.
   * - `GET /api/boards` — JSON list of board ids (access key or admin token required when an access key is set)
   * - `DELETE /api/boards/<id>` — delete one board (admin token required)
   * - `DELETE /api/boards?olderThanDays=N` — delete boards not modified for N days
   *   and not currently open (admin token required)
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean
}

export interface BoardServerOptions {
  dataDir: string
  /** Bearer token required for deleting boards. Unset or empty disables deletion. */
  adminToken?: string
  /**
   * Shared access key. When set, joining a board and listing boards require it;
   * unset or empty = anyone may use the server.
   */
  accessKey?: string
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest()

/** Constant-time comparison of an untrusted value with a secret. */
function sameSecret(given: unknown, secret: string): boolean {
  // Hashing first gives equal-length buffers, as timingSafeEqual requires.
  return typeof given === 'string' && crypto.timingSafeEqual(sha256(given), sha256(secret))
}

/** Constant-time check of an `Authorization: Bearer <token>` header. */
function hasToken(req: IncomingMessage, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  return !!m && sameSecret(m[1].trim(), token)
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : fallback)

/** Clean an untrusted patch: invalid elements are dropped, ids must be strings. */
function sanitizePatch(raw: unknown): Patch | null {
  if (!isObj(raw)) return null
  const upserts = sanitizeElements(raw.upserts)
  const deletes = Array.isArray(raw.deletes) ? raw.deletes.filter((id): id is string => typeof id === 'string') : []
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : undefined
  return order ? { upserts, deletes, order } : { upserts, deletes }
}

/**
 * Real-time board rooms over WebSocket. Each room applies ops in arrival order
 * and relays every op to every member (the sender treats its own echo as an
 * acknowledgement), so all clients converge on the server's state. Rooms are
 * persisted as JSON files under `dataDir` and unloaded when the last member leaves.
 */
export function createBoardServer(opts: BoardServerOptions): BoardServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  const rooms = new Map<string, Room>()
  fs.mkdirSync(opts.dataDir, { recursive: true })

  const fileFor = (id: string) => path.join(opts.dataDir, `${id}.json`)

  function load(id: string): Room {
    let elements: BoardElement[] = []
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'))
      elements = sanitizeElements(isObj(raw) ? raw.elements : null)
    } catch {
      // New board (or unreadable file): start empty.
    }
    return { id, elements, sockets: new Set(), peers: new Map(), saveTimer: null, deleted: false }
  }

  function save(room: Room) {
    if (room.saveTimer) clearTimeout(room.saveTimer)
    room.saveTimer = null
    if (room.deleted) return
    const file = fileFor(room.id)
    // Opening a board's URL shouldn't create it: only persist boards that have
    // content, or that were saved before (e.g. one someone cleared on purpose).
    // Otherwise any visit (an old tab reconnecting, an iframe, a link preview)
    // would bring back a deleted board or litter the disk with empty ones.
    if (room.elements.length === 0 && !fs.existsSync(file)) return
    // Write-then-rename so a crash never leaves a half-written board.
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, elements: room.elements }))
    fs.renameSync(`${file}.tmp`, file)
  }

  function scheduleSave(room: Room) {
    if (!room.saveTimer) room.saveTimer = setTimeout(() => save(room), SAVE_DELAY_MS)
  }

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
  const broadcast = (room: Room, msg: ServerMessage, except?: WebSocket) => {
    const data = JSON.stringify(msg)
    for (const ws of room.peers.keys()) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data)
  }

  function join(roomId: string, ws: WebSocket) {
    let room = rooms.get(roomId)
    if (!room) {
      room = load(roomId)
      rooms.set(roomId, room)
    }
    const r = room
    // Counted from the start: unloading a room while a socket is mid-handshake
    // would strand it in a copy that newcomers never see.
    r.sockets.add(ws)
    let peer: PeerPresence | null = null

    ws.on('message', (data) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (!isObj(msg)) return

      if (msg.type === 'hello' && !peer) {
        if (opts.accessKey && !sameSecret(msg.key, opts.accessKey)) {
          // Nothing about the board is sent; the client asks its user for the key.
          send(ws, { type: 'unauthorized' })
          ws.close(1008, 'Access key required')
          return
        }
        peer = {
          clientId: str(msg.clientId, 64, Math.random().toString(36).slice(2)),
          name: str(msg.name, 40, 'Guest'),
          color: /^#[0-9a-f]{6}$/i.test(String(msg.color)) ? msg.color : '#1971c2',
          cursor: null,
          selection: [],
        }
        send(ws, { type: 'init', elements: r.elements, peers: [...r.peers.values()] })
        r.peers.set(ws, peer)
        broadcast(r, { type: 'presence', peer }, ws)
        return
      }
      if (!peer) return // must say hello first

      if (msg.type === 'op') {
        const patch = sanitizePatch(msg.patch)
        if (!patch || typeof msg.opId !== 'number') return
        const next = applyPatch(r.elements, patch)
        if (next.length > MAX_ELEMENTS) {
          send(ws, { type: 'error', message: 'This board is full.' })
          // Still acknowledge so the client drops the op, but with nothing applied.
          send(ws, { type: 'op', clientId: peer.clientId, opId: msg.opId, patch: { upserts: [], deletes: [] } })
          return
        }
        r.elements = next
        scheduleSave(r)
        broadcast(r, { type: 'op', clientId: peer.clientId, opId: msg.opId, patch })
      } else if (msg.type === 'presence') {
        const c = msg.cursor
        peer.cursor = isObj(c) && Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: Number(c.x), y: Number(c.y) } : null
        peer.selection = Array.isArray(msg.selection)
          ? msg.selection.filter((id): id is string => typeof id === 'string').slice(0, 1000)
          : []
        peer.name = str(msg.name, 40, peer.name)
        if (/^#[0-9a-f]{6}$/i.test(String(msg.color))) peer.color = msg.color
        broadcast(r, { type: 'presence', peer }, ws)
      }
    })

    ws.on('close', () => {
      r.sockets.delete(ws)
      r.peers.delete(ws)
      const id = peer?.clientId
      if (id && ![...r.peers.values()].some((p) => p.clientId === id)) broadcast(r, { type: 'leave', clientId: id })
      if (r.sockets.size === 0) {
        save(r)
        // Only unload this room: after a delete, the same id may already be a new room.
        if (rooms.get(r.id) === r) rooms.delete(r.id)
      }
    })
  }

  function listBoards(): string[] {
    // Saved boards, plus open ones that have content but haven't been saved yet.
    // (An empty board someone merely has open isn't a board yet.)
    const ids = new Set([...rooms.values()].filter((r) => r.elements.length > 0).map((r) => r.id))
    for (const name of fs.readdirSync(opts.dataDir)) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (BOARD_ID_PATTERN.test(id)) ids.add(id)
    }
    return [...ids].sort()
  }

  /**
   * Delete a board: tell anyone connected (their clients stop reconnecting, so
   * they don't recreate it), drop it from memory without saving, remove its file.
   * Returns false if there was no such board.
   */
  function deleteBoard(id: string): boolean {
    let existed = false
    const room = rooms.get(id)
    if (room) {
      existed = true
      room.deleted = true
      if (room.saveTimer) clearTimeout(room.saveTimer)
      room.saveTimer = null
      rooms.delete(id)
      for (const ws of room.sockets) {
        send(ws, { type: 'deleted' })
        ws.close(1000, 'Board deleted')
      }
    }
    for (const file of [fileFor(id), `${fileFor(id)}.tmp`]) {
      try {
        fs.unlinkSync(file)
        existed = true
      } catch {
        // Not on disk (never saved, or already gone).
      }
    }
    return existed
  }

  /** Delete saved boards not modified within `days` days, except boards that are open right now. */
  function deleteOlderThan(days: number): { deleted: string[]; skippedOpen: string[] } {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const deleted: string[] = []
    const skippedOpen: string[] = []
    for (const name of fs.readdirSync(opts.dataDir)) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (!BOARD_ID_PATTERN.test(id)) continue
      let mtime: number
      try {
        mtime = fs.statSync(fileFor(id)).mtimeMs
      } catch {
        continue
      }
      if (mtime >= cutoff) continue
      if (rooms.has(id)) skippedOpen.push(id)
      else if (deleteBoard(id)) deleted.push(id)
    }
    return { deleted: deleted.sort(), skippedOpen: skippedOpen.sort() }
  }

  /** Checks the admin token; on failure writes the error response and returns false. */
  function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
    if (!opts.adminToken) {
      json(res, 403, { error: 'Deleting boards is disabled. Set ADMIN_TOKEN on the server to enable it.' })
      return false
    }
    if (!hasToken(req, opts.adminToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      json(res, 401, { error: 'Missing or invalid admin token.' })
      return false
    }
    return true
  }

  return {
    handleRequest(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')

      if (url.pathname === '/api/boards') {
        if (req.method === 'GET' || req.method === 'HEAD') {
          // The key may also come as ?key=, like page links, so the list opens in a browser.
          // (A header is better for scripts: URLs end up in logs and history.)
          const allowed =
            !opts.accessKey ||
            hasToken(req, opts.accessKey) ||
            sameSecret(url.searchParams.get('key') ?? undefined, opts.accessKey) ||
            (!!opts.adminToken && hasToken(req, opts.adminToken))
          if (!allowed) {
            res.setHeader('WWW-Authenticate', 'Bearer')
            json(res, 401, { error: 'Missing or invalid access key.' })
            return true
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ boards: listBoards() }))
        } else if (req.method === 'DELETE') {
          if (!requireAdmin(req, res)) return true
          // Required, so a bare DELETE can never wipe everything by accident.
          const raw = url.searchParams.get('olderThanDays')
          const days = raw === null ? NaN : Number(raw)
          if (!Number.isFinite(days) || days < 0) {
            json(res, 400, { error: 'Give olderThanDays, a number of days (0 or more).' })
            return true
          }
          json(res, 200, deleteOlderThan(days))
        } else {
          res.writeHead(405, { Allow: 'GET, HEAD, DELETE' }).end()
        }
        return true
      }

      const one = /^\/api\/boards\/([^/]+)$/.exec(url.pathname)
      if (one) {
        if (req.method !== 'DELETE') {
          res.writeHead(405, { Allow: 'DELETE' }).end()
          return true
        }
        let id: string
        try {
          id = decodeURIComponent(one[1])
        } catch {
          id = ''
        }
        if (!BOARD_ID_PATTERN.test(id)) {
          json(res, 400, { error: 'Invalid board id.' })
          return true
        }
        if (!requireAdmin(req, res)) return true
        if (deleteBoard(id)) res.writeHead(204).end()
        else json(res, 404, { error: 'No such board.' })
        return true
      }

      return false
    },
    handleUpgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/ws') return false
      const roomId = url.searchParams.get('board') ?? ''
      if (!BOARD_ID_PATTERN.test(roomId)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return true
      }
      wss.handleUpgrade(req, socket, head, (ws) => join(roomId, ws))
      return true
    },
    async close() {
      for (const room of rooms.values()) {
        save(room)
        for (const ws of room.sockets) ws.close()
      }
      rooms.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
