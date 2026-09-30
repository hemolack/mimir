import { newId } from './ops'
import { BOARD_ID_PATTERN } from './protocol'
import type { PeerInfo } from './protocol'

const IDENTITY_KEY = 'whiteboard.identity.v1'

const PEER_COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#0c8599', '#9c36b5', '#c2255c', '#5f3dc4']
const ANIMALS = ['Otter', 'Falcon', 'Panda', 'Lynx', 'Heron', 'Koala', 'Fox', 'Orca', 'Moose', 'Gecko', 'Ibis', 'Yak']

/** This user's display name and color (remembered), with a fresh id per tab. */
export function loadIdentity(): PeerInfo {
  let saved: Partial<PeerInfo> = {}
  try {
    saved = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? '{}')
  } catch {
    // ignore
  }
  const identity = {
    name: typeof saved.name === 'string' && saved.name ? saved.name.slice(0, 40) : `${pick(ANIMALS)} ${Math.floor(Math.random() * 90 + 10)}`,
    color: typeof saved.color === 'string' && /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : pick(PEER_COLORS),
  }
  saveIdentity(identity)
  // Per tab, so two tabs of the same person show up as two cursors.
  return { ...identity, clientId: newId() }
}

export function saveIdentity(identity: { name: string; color: string }) {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ name: identity.name, color: identity.color }))
  } catch {
    // ignore
  }
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** The shared board id from a /board/<id> URL, or null for the private local board. */
export function boardIdFromPath(pathname: string): string | null {
  const m = /^\/board\/([^/]+)\/?$/.exec(pathname)
  if (!m) return null
  const id = decodeURIComponent(m[1])
  return BOARD_ID_PATTERN.test(id) ? id : null
}

/** A short, URL-safe, hard-to-guess board id. */
export function newBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}

const SEED_PREFIX = 'whiteboard.seed.'

/** Carry the current local board into a newly created shared board (read once, on first connect). */
export function stashSeed(board: string, elements: unknown[]) {
  try {
    sessionStorage.setItem(SEED_PREFIX + board, JSON.stringify(elements))
  } catch {
    // ignore
  }
}

export function takeSeed(board: string): unknown {
  try {
    const raw = sessionStorage.getItem(SEED_PREFIX + board)
    sessionStorage.removeItem(SEED_PREFIX + board)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
