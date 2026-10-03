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
}

export interface BoardServer {
  /** Handle an HTTP upgrade if it is for /ws; returns false to let others handle it. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean
  /** Save all rooms and disconnect everyone. */
  close(): Promise<void>
  /** Handle `GET /api/boards` (JSON list of board ids); returns false for any other request. */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean
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
export function createBoardServer(opts: { dataDir: string }): BoardServer {
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
    return { id, elements, sockets: new Set(), peers: new Map(), saveTimer: null }
  }

  function save(room: Room) {
    if (room.saveTimer) clearTimeout(room.saveTimer)
    room.saveTimer = null
    const file = fileFor(room.id)
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
        rooms.delete(r.id)
      }
    })
  }

  function listBoards(): string[] {
    const ids = new Set(rooms.keys())
    for (const name of fs.readdirSync(opts.dataDir)) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (BOARD_ID_PATTERN.test(id)) ids.add(id)
    }
    return [...ids].sort()
  }

  return {
    handleRequest(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/api/boards') return false
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end()
        return true
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ boards: listBoards() }))
      return true
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
