import { useMemo, useReducer, useRef } from 'react'
import type { BoardElement } from './types'

const MAX_HISTORY = 200

export interface Board {
  elements: BoardElement[]
  canUndo: boolean
  canRedo: boolean
  /** Latest elements, safe to read from event handlers between renders. */
  get(): BoardElement[]
  /** Replace elements without recording history (call checkpoint() first). */
  update(fn: (elements: BoardElement[]) => BoardElement[]): void
  /** Record the current state so the next changes can be undone. */
  checkpoint(): void
  /** Checkpoint + update in one step. */
  change(fn: (elements: BoardElement[]) => BoardElement[]): void
  /** Roll back to the last checkpoint and forget it (for cancelled gestures). */
  discardCheckpoint(): void
  undo(): void
  redo(): void
}

interface State {
  elements: BoardElement[]
  past: BoardElement[][]
  future: BoardElement[][]
}

/**
 * Board state lives in a ref so pointer handlers that fire many times between
 * renders always see the latest elements; a counter triggers re-renders.
 */
export function useBoard(init: () => BoardElement[]): Board {
  const state = useRef<State | null>(null)
  if (state.current === null) state.current = { elements: init(), past: [], future: [] }
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const actions = useMemo(() => {
    const s = () => state.current!
    const checkpoint = () => {
      const st = s()
      st.past.push(st.elements)
      if (st.past.length > MAX_HISTORY) st.past.shift()
      st.future = []
      rerender()
    }
    const update = (fn: (elements: BoardElement[]) => BoardElement[]) => {
      const st = s()
      const next = fn(st.elements)
      if (next !== st.elements) {
        st.elements = next
        rerender()
      }
    }
    return {
      get: () => s().elements,
      update,
      checkpoint,
      change(fn: (elements: BoardElement[]) => BoardElement[]) {
        checkpoint()
        update(fn)
      },
      discardCheckpoint() {
        const prev = s().past.pop()
        if (prev) {
          s().elements = prev
          rerender()
        }
      },
      undo() {
        const st = s()
        const prev = st.past.pop()
        if (!prev) return
        st.future.push(st.elements)
        st.elements = prev
        rerender()
      },
      redo() {
        const st = s()
        const next = st.future.pop()
        if (!next) return
        st.past.push(st.elements)
        st.elements = next
        rerender()
      },
    }
  }, [])

  const st = state.current
  return {
    ...actions,
    elements: st.elements,
    canUndo: st.past.length > 0,
    canRedo: st.future.length > 0,
  }
}
