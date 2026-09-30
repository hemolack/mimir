import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPatch, diffElements } from '../src/patch'
import type { PeerPresence } from '../src/protocol'
import { SyncClient } from '../src/sync'
import type { BoardElement, ShapeElement } from '../src/types'
import { createBoardServer } from './boards'
import type { BoardServer } from './boards'

// End-to-end: a real board server and real SyncClients over WebSocket (Node's global WebSocket).

let server: http.Server
let boards: BoardServer
let dataDir: string
let port: number

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-test-'))
  boards = createBoardServer({ dataDir })
  server = http.createServer()
  server.on('upgrade', (req, socket, head) => {
    if (!boards.handleUpgrade(req, socket, head)) socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  port = (server.address() as AddressInfo).port
  // SyncClient builds its URL from the page location.
  ;(globalThis as { location?: unknown }).location = { protocol: 'http:', host: `localhost:${port}` }
})

afterAll(async () => {
  await boards.close()
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const shape = (id: string, x = 0): ShapeElement => ({
  id,
  type: 'shape',
  kind: 'rectangle',
  x,
  y: 0,
  w: 10,
  h: 10,
  fill: 'none',
  stroke: '#000',
  strokeWidth: 2,
  dash: 'solid',
  label: '',
  fontSize: 18,
})

async function waitFor(check: () => boolean, what: string, timeout = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** A client plus the element list a UI would show, kept like the app keeps it. */
function connect(board: string, name: string) {
  const state = { elements: [] as BoardElement[], peers: [] as PeerPresence[], online: false, inits: 0 }
  const client = new SyncClient(board, { clientId: `${name}-${Math.random()}`, name, color: '#1971c2' }, {
    onState(els) {
      state.elements = els
      state.inits++
    },
    onStatus: (s) => (state.online = s === 'online'),
    onPeers: (p) => (state.peers = p),
    onError: () => {},
  })
  /** Make a local edit the way the board store does: apply, then hand the diff to sync. */
  const edit = (fn: (els: BoardElement[]) => BoardElement[]) => {
    const next = fn(state.elements)
    client.local(diffElements(state.elements, next))
    state.elements = next
  }
  return { client, state, edit }
}

const xOf = (els: BoardElement[], id: string) => (els.find((e) => e.id === id) as ShapeElement | undefined)?.x

describe('real-time sync', () => {
  it('shows one user’s changes to another', async () => {
    const a = connect('room-basic', 'Ann')
    const b = connect('room-basic', 'Ben')
    await waitFor(() => a.state.online && b.state.online, 'both online')

    a.edit((els) => [...els, shape('s1', 5)])
    await waitFor(() => xOf(b.state.elements, 's1') === 5, 'B to see the new shape')

    b.edit((els) => els.map((e) => (e.id === 's1' ? { ...e, x: 42 } : e)))
    await waitFor(() => xOf(a.state.elements, 's1') === 42, 'A to see B’s move')

    a.edit((els) => els.filter((e) => e.id !== 's1'))
    await waitFor(() => b.state.elements.length === 0, 'B to see the delete')
    a.client.close()
    b.client.close()
  })

  it('converges when both edit the same element at the same time', async () => {
    const a = connect('room-conflict', 'Ann')
    const b = connect('room-conflict', 'Ben')
    await waitFor(() => a.state.online && b.state.online, 'both online')
    a.edit((els) => [...els, shape('s', 0)])
    await waitFor(() => xOf(b.state.elements, 's') === 0, 'B to see the shape')

    // Conflicting edits sent before either sees the other's.
    for (let i = 1; i <= 20; i++) {
      a.edit((els) => els.map((e) => (e.id === 's' ? { ...e, x: 1000 + i } : e)))
      b.edit((els) => els.map((e) => (e.id === 's' ? { ...e, x: 2000 + i } : e)))
    }
    await waitFor(
      () => xOf(a.state.elements, 's') === xOf(b.state.elements, 's') && [1020, 2020].includes(xOf(a.state.elements, 's')!),
      'both clients to agree on the last edit',
    )
    a.client.close()
    b.client.close()
  })

  it('shares presence (cursor, selection, name)', async () => {
    const a = connect('room-presence', 'Ann')
    const b = connect('room-presence', 'Ben')
    await waitFor(() => a.state.online && b.state.online, 'both online')
    a.client.setPresence({ x: 7, y: 8 }, ['x'], { name: 'Annie', color: '#e03131' })
    await waitFor(() => b.state.peers.some((p) => p.name === 'Annie' && p.cursor?.x === 7 && p.selection[0] === 'x'), 'B to see A’s cursor')
    a.client.close()
    await waitFor(() => !b.state.peers.some((p) => p.name === 'Annie'), 'A to leave B’s peer list')
    b.client.close()
  })

  it('persists boards and loads them for later visitors', async () => {
    const a = connect('room-persist', 'Ann')
    await waitFor(() => a.state.online, 'online')
    a.edit((els) => [...els, shape('keep', 3)])
    await new Promise((r) => setTimeout(r, 100))
    a.client.close()
    await waitFor(() => fs.existsSync(path.join(dataDir, 'room-persist.json')), 'the board file')

    const later = connect('room-persist', 'Cat')
    await waitFor(() => xOf(later.state.elements, 'keep') === 3, 'the saved shape')
    later.client.close()
  })

  it('sends edits made while connecting once the board loads', async () => {
    const a = connect('room-early', 'Ann')
    a.edit((els) => [...els, shape('early', 9)]) // before 'init' arrives
    const b = connect('room-early', 'Ben')
    await waitFor(() => xOf(b.state.elements, 'early') === 9, 'B to receive the early edit')
    a.client.close()
    b.client.close()
  })

  it('rejects invalid elements without breaking the room', async () => {
    const a = connect('room-junk', 'Ann')
    const b = connect('room-junk', 'Ben')
    await waitFor(() => a.state.online && b.state.online, 'both online')
    a.client.local({ upserts: [{ id: 'bad', type: 'shape' } as unknown as BoardElement, shape('good', 1)], deletes: [] })
    await waitFor(() => xOf(b.state.elements, 'good') === 1, 'the valid element')
    expect(b.state.elements.some((e) => e.id === 'bad')).toBe(false)
    a.client.close()
    b.client.close()
  })

  it('keeps a mid-handshake connection in the same room when the last member leaves', async () => {
    // Connected but hasn't said hello yet (like a page that is still starting up).
    const early = new WebSocket(`ws://localhost:${port}/ws?board=room-race`)
    const received: string[] = []
    early.onmessage = (e) => received.push(JSON.parse(String(e.data)).type)
    await new Promise((r) => (early.onopen = r))

    const a = connect('room-race', 'Ann')
    await waitFor(() => a.state.online, 'A online')
    a.client.close() // the only member who said hello leaves
    await new Promise((r) => setTimeout(r, 100))

    early.send(JSON.stringify({ type: 'hello', clientId: 'early', name: 'Early', color: '#000000' }))
    await waitFor(() => received.includes('init'), 'init for the early socket')
    const c = connect('room-race', 'Cat')
    await waitFor(() => c.state.online, 'C online')
    c.edit((els) => [...els, shape('race', 1)])
    await waitFor(() => received.includes('op'), 'the early socket to receive C’s edit')
    early.close()
    c.client.close()
  })

  it('refuses board ids that are not URL-safe', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?board=${encodeURIComponent('../etc')}`)
    const outcome = await new Promise((resolve) => {
      ws.onopen = () => resolve('open')
      ws.onerror = () => resolve('error')
    })
    expect(outcome).toBe('error')
  })

  it('keeps the view equal to server state + pending edits', () => {
    // Sanity check of the model the client relies on.
    const confirmed = [shape('a')]
    const pending = diffElements(confirmed, [shape('a', 5), shape('b')])
    expect(applyPatch(confirmed, pending).map((e) => e.id)).toEqual(['a', 'b'])
  })
})
