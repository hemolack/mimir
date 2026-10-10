import type { BoardElement } from './types.ts'

/**
 * A change to a board: elements added or replaced (by id), ids removed, and
 * optionally a new stacking order. Patches are what gets sent between
 * collaborators and what undo/redo apply, so that each only touches the
 * elements it is about and never clobbers other people's work.
 */
export interface Patch {
  upserts: BoardElement[]
  deletes: string[]
  /** Full bottom-to-top id order, present only when the relative order changed. */
  order?: string[]
}

export const isEmptyPatch = (p: Patch) => p.upserts.length === 0 && p.deletes.length === 0 && !p.order

/**
 * What changed from `prev` to `next`. Elements are immutable, so an element
 * counts as changed exactly when its object identity changed.
 */
export function diffElements(prev: BoardElement[], next: BoardElement[]): Patch {
  const prevMap = new Map(prev.map((el) => [el.id, el]))
  const nextIds = new Set(next.map((el) => el.id))
  const upserts = next.filter((el) => prevMap.get(el.id) !== el)
  const deletes = prev.filter((el) => !nextIds.has(el.id)).map((el) => el.id)

  // Order changed if surviving elements were reshuffled, or new ones were
  // inserted anywhere but on top (applyPatch appends new elements).
  const prevCommon = prev.filter((el) => nextIds.has(el.id))
  const nextCommon = next.filter((el) => prevMap.has(el.id))
  let reordered = prevCommon.some((el, i) => el.id !== nextCommon[i].id)
  if (!reordered && nextCommon.length) {
    const lastCommon = next.lastIndexOf(nextCommon[nextCommon.length - 1])
    reordered = next.slice(0, lastCommon).some((el) => !prevMap.has(el.id))
  }
  return reordered ? { upserts, deletes, order: next.map((el) => el.id) } : { upserts, deletes }
}

/** Sort elements into `order`; elements not listed keep their relative order on top. */
export function applyOrder(elements: BoardElement[], order: string[]): BoardElement[] {
  const pos = new Map(order.map((id, i) => [id, i]))
  const listed = elements.filter((el) => pos.has(el.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
  return [...listed, ...elements.filter((el) => !pos.has(el.id))]
}

export function applyPatch(elements: BoardElement[], patch: Patch): BoardElement[] {
  if (isEmptyPatch(patch)) return elements
  const deleted = new Set(patch.deletes)
  const pending = new Map(patch.upserts.map((el) => [el.id, el]))
  const out: BoardElement[] = []
  for (const el of elements) {
    if (deleted.has(el.id)) continue
    const replacement = pending.get(el.id)
    if (replacement) pending.delete(el.id)
    out.push(replacement ?? el)
  }
  out.push(...pending.values()) // new elements go on top
  return patch.order ? applyOrder(out, patch.order) : out
}

/** One patch with the effect of applying `a` then `b`. */
export function mergePatches(a: Patch, b: Patch): Patch {
  const upserts = new Map(a.upserts.map((el) => [el.id, el]))
  const deletes = new Set(a.deletes)
  for (const id of b.deletes) {
    upserts.delete(id)
    deletes.add(id)
  }
  for (const el of b.upserts) {
    deletes.delete(el.id)
    upserts.set(el.id, el)
  }
  const order = b.order ?? a.order
  const merged: Patch = { upserts: [...upserts.values()], deletes: [...deletes] }
  return order ? { ...merged, order } : merged
}
