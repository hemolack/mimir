import type { Patch } from './patch.ts'
import type { BoardElement, Point } from './types.ts'

/** Board ids appear in URLs (/board/<id>) and file names, so keep them tame. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface PeerInfo {
  clientId: string
  name: string
  color: string
}

export interface PeerPresence extends PeerInfo {
  /** World coordinates, or null when the pointer is off the board. */
  cursor: Point | null
  selection: string[]
}

export type ClientMessage =
  | { type: 'hello'; clientId: string; name: string; color: string }
  | { type: 'op'; opId: number; patch: Patch }
  | { type: 'presence'; cursor: Point | null; selection: string[]; name: string; color: string }

export type ServerMessage =
  | { type: 'init'; elements: BoardElement[]; peers: PeerPresence[] }
  /** Every op, in the server's order — including your own, as the acknowledgement. */
  | { type: 'op'; clientId: string; opId: number; patch: Patch }
  | { type: 'presence'; peer: PeerPresence }
  | { type: 'leave'; clientId: string }
  | { type: 'error'; message: string }
  /** The board was deleted by an administrator; the connection closes and must not reconnect. */
  | { type: 'deleted' }
