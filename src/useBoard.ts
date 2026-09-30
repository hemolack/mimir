import { useReducer, useRef } from 'react'
import { createBoardStore } from './boardStore'
import type { BoardStore } from './boardStore'
import type { Patch } from './patch'
import type { BoardElement } from './types'

export interface Board extends Omit<BoardStore, 'canUndo' | 'canRedo'> {
  elements: BoardElement[]
  canUndo: boolean
  canRedo: boolean
}

/**
 * React wrapper around the board store. The store is plain mutable state so
 * pointer handlers that fire many times between renders always see the latest
 * elements; each change bumps a counter to re-render.
 * `onLocalChange` receives every local change as a patch (for syncing).
 */
export function useBoard(init: () => BoardElement[], onLocalChange?: (patch: Patch) => void): Board {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const listener = useRef(onLocalChange)
  listener.current = onLocalChange
  const store = useRef<BoardStore | null>(null)
  store.current ??= createBoardStore(init(), {
    onLocalChange: (patch) => listener.current?.(patch),
    onChange: rerender,
  })
  const s = store.current
  return {
    ...s,
    elements: s.get(),
    canUndo: s.canUndo(),
    canRedo: s.canRedo(),
  }
}
