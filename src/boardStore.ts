import { applyPatch, diffElements, isEmptyPatch } from './patch'
import type { Patch } from './patch'
import type { BoardElement } from './types'

const MAX_HISTORY = 200

/**
 * One undo step: for every element this user changed during the step, its
 * value before and after the step (null = didn't exist), plus the prior
 * stacking order if it changed. Undo reverts only the properties the step
 * changed, so collaborators' concurrent edits (even to the same element) survive.
 */
interface Step {
  before: Map<string, BoardElement | null>
  after: Map<string, BoardElement | null>
  orderBefore: string[] | null
}

export interface BoardStore {
  /** Latest elements, safe to read from event handlers between renders. */
  get(): BoardElement[]
  canUndo(): boolean
  canRedo(): boolean
  /** Apply a local change. It joins the current undo step (call checkpoint() first to start one). */
  update(fn: (elements: BoardElement[]) => BoardElement[]): void
  /** Start a new undo step. */
  checkpoint(): void
  /** Checkpoint + update in one step. */
  change(fn: (elements: BoardElement[]) => BoardElement[]): void
  /** Revert the current undo step and forget it (for cancelled gestures). */
  discardCheckpoint(): void
  undo(): void
  redo(): void
  /** Replace the board with state from collaborators. Not recorded in history, not reported as local. */
  applyRemote(elements: BoardElement[]): void
}

const newStep = (): Step => ({ before: new Map(), after: new Map(), orderBefore: null })
const isEmptyStep = (s: Step) => s.before.size === 0 && !s.orderBefore

/** Track what `patch` touches: first-seen value as `before`, latest value as `after`. */
function record(step: Step, prev: BoardElement[], patch: Patch) {
  const prevMap = new Map(prev.map((el) => [el.id, el]))
  for (const el of patch.upserts) {
    if (!step.before.has(el.id)) step.before.set(el.id, prevMap.get(el.id) ?? null)
    step.after.set(el.id, el)
  }
  for (const id of patch.deletes) {
    if (!step.before.has(id)) step.before.set(id, prevMap.get(id) ?? null)
    step.after.set(id, null)
  }
  if (!step.orderBefore && (patch.order || patch.deletes.length)) step.orderBefore = prev.map((el) => el.id)
}

/**
 * `current` with just the properties that changed from `from` to `to` set back
 * to their `from` values. Elements are updated immutably, so unchanged
 * properties keep their identity and a reference comparison finds the changes.
 */
function revertProps(current: BoardElement, from: BoardElement, to: BoardElement): BoardElement {
  if (from.type !== to.type || current.type !== to.type) return from
  const out: Record<string, unknown> = { ...current }
  const a = from as unknown as Record<string, unknown>
  const b = to as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] === b[key]) continue
    if (key in a) out[key] = a[key]
    else delete out[key]
  }
  return out as unknown as BoardElement
}

/** The patch that reverts a step against the current board, plus the step that would redo it. */
function invert(step: Step, current: BoardElement[]): { patch: Patch; reverse: Step } {
  const curMap = new Map(current.map((el) => [el.id, el]))
  const patch: Patch = { upserts: [], deletes: [] }
  const reverse: Step = { before: new Map(), after: new Map(), orderBefore: step.orderBefore ? current.map((el) => el.id) : null }
  for (const [id, before] of step.before) {
    const after = step.after.get(id) ?? null
    const cur = curMap.get(id) ?? null
    let restored: BoardElement | null
    if (before === null) {
      restored = null // we created it: remove it
    } else if (after === null) {
      restored = before // we deleted it: bring it back
    } else if (!cur) {
      continue // someone else deleted it since; don't resurrect it
    } else {
      restored = revertProps(cur, before, after)
    }
    if (restored === null) {
      if (!cur) continue
      patch.deletes.push(id)
    } else {
      patch.upserts.push(restored)
    }
    reverse.before.set(id, cur)
    reverse.after.set(id, restored)
  }
  if (step.orderBefore) patch.order = step.orderBefore
  return { patch, reverse }
}

/**
 * Board elements plus per-user undo history. `onLocalChange` receives every
 * local change (including undo/redo) as a patch, for syncing; `onChange` fires
 * after any change so a UI can re-render.
 */
export function createBoardStore(
  initial: BoardElement[],
  hooks: { onLocalChange?: (patch: Patch) => void; onChange?: () => void } = {},
): BoardStore {
  let elements = initial
  let past: Step[] = []
  let future: Step[] = []
  const changed = () => hooks.onChange?.()

  /** Set elements and report the change; returns the patch that was applied. */
  const commit = (next: BoardElement[]): Patch | null => {
    if (next === elements) return null
    const patch = diffElements(elements, next)
    elements = next
    changed()
    if (!isEmptyPatch(patch)) hooks.onLocalChange?.(patch)
    return patch
  }

  const checkpoint = () => {
    past.push(newStep())
    if (past.length > MAX_HISTORY) past = past.slice(-MAX_HISTORY)
    future = []
    changed()
  }

  const update = (fn: (elements: BoardElement[]) => BoardElement[]) => {
    const prev = elements
    const patch = commit(fn(prev))
    const step = past[past.length - 1]
    if (patch && step) record(step, prev, patch)
  }

  /** Pop the newest non-empty step from `from`, apply its inverse, and push the step that reverses it. */
  const travel = (from: Step[], to: Step[]) => {
    let step = from.pop()
    while (step && isEmptyStep(step)) step = from.pop()
    if (step) {
      const { patch, reverse } = invert(step, elements)
      commit(applyPatch(elements, patch))
      to.push(reverse)
    }
    changed()
  }

  return {
    get: () => elements,
    canUndo: () => past.some((s) => !isEmptyStep(s)),
    canRedo: () => future.length > 0,
    update,
    checkpoint,
    change(fn) {
      checkpoint()
      update(fn)
    },
    discardCheckpoint() {
      // Exactly the newest step, even if empty — never an older one.
      const step = past.pop()
      if (step) commit(applyPatch(elements, invert(step, elements).patch))
      changed()
    },
    undo: () => travel(past, future),
    redo: () => travel(future, past),
    applyRemote(next) {
      elements = next
      changed()
    },
  }
}
