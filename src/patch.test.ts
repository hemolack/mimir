import { describe, expect, it } from 'vitest'
import { createBoardStore } from './boardStore'
import { applyOrder, applyPatch, diffElements, mergePatches } from './patch'
import type { Patch } from './patch'
import type { BoardElement, ShapeElement } from './types'

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
const ids = (els: BoardElement[]) => els.map((e) => e.id)
const xOf = (els: BoardElement[], id: string) => (els.find((e) => e.id === id) as ShapeElement).x

describe('diffElements / applyPatch', () => {
  const a = shape('a')
  const b = shape('b')
  const c = shape('c')

  it('round-trips adds, changes and deletes', () => {
    const prev = [a, b, c]
    const next = [a, { ...b, x: 5 }, shape('d')]
    const patch = diffElements(prev, next)
    expect(patch.deletes).toEqual(['c'])
    expect(ids(patch.upserts)).toEqual(['b', 'd'])
    expect(patch.order).toBeUndefined()
    expect(applyPatch(prev, patch)).toEqual(next)
  })

  it('reports reordering', () => {
    const patch = diffElements([a, b, c], [c, a, b])
    expect(patch.order).toEqual(['c', 'a', 'b'])
    expect(patch.upserts).toEqual([])
    expect(ids(applyPatch([a, b, c], patch))).toEqual(['c', 'a', 'b'])
  })

  it('reports new elements inserted below existing ones', () => {
    const d = shape('d')
    const patch = diffElements([a, b], [d, a, b])
    expect(ids(applyPatch([a, b], patch))).toEqual(['d', 'a', 'b'])
  })

  it('is empty when nothing changed', () => {
    expect(diffElements([a, b], [a, b])).toEqual({ upserts: [], deletes: [] })
  })

  it('leaves unknown elements on top when ordering', () => {
    expect(ids(applyOrder([a, b, c], ['c', 'a']))).toEqual(['c', 'a', 'b'])
  })
})

describe('mergePatches', () => {
  it('equals applying both in sequence', () => {
    const base = [shape('a'), shape('b'), shape('c')]
    const p1: Patch = { upserts: [shape('a', 1), shape('d')], deletes: ['b'] }
    const p2: Patch = { upserts: [shape('a', 2)], deletes: ['d', 'c'] }
    expect(applyPatch(base, mergePatches(p1, p2))).toEqual(applyPatch(applyPatch(base, p1), p2))
  })

  it('lets a later upsert revive a deleted id', () => {
    const merged = mergePatches({ upserts: [], deletes: ['a'] }, { upserts: [shape('a', 9)], deletes: [] })
    expect(merged.deletes).toEqual([])
    expect(xOf(merged.upserts, 'a')).toBe(9)
  })
})

describe('per-user undo', () => {
  it('undoes only this user’s changes, keeping concurrent remote edits', () => {
    const store = createBoardStore([shape('mine'), shape('theirs')])
    store.change((els) => els.map((e) => (e.id === 'mine' ? { ...e, x: 100 } : e)))
    // A collaborator moves their element meanwhile.
    store.applyRemote(store.get().map((e) => (e.id === 'theirs' ? { ...e, x: 50 } : e)))
    store.undo()
    expect(xOf(store.get(), 'mine')).toBe(0)
    expect(xOf(store.get(), 'theirs')).toBe(50)
    store.redo()
    expect(xOf(store.get(), 'mine')).toBe(100)
    expect(xOf(store.get(), 'theirs')).toBe(50)
  })

  it('reverts only the properties it changed, even on an element someone else also edited', () => {
    const store = createBoardStore([shape('s')])
    store.change((els) => els.map((e) => ({ ...e, label: 'mine' }) as BoardElement))
    // A collaborator then moves the same shape.
    store.applyRemote(store.get().map((e) => ({ ...e, x: 77 })))
    store.undo()
    const s = store.get()[0] as ShapeElement
    expect(s.label).toBe('')
    expect(s.x).toBe(77)
    store.redo()
    expect((store.get()[0] as ShapeElement).label).toBe('mine')
    expect((store.get()[0] as ShapeElement).x).toBe(77)
  })

  it('does not resurrect an element a collaborator deleted', () => {
    const store = createBoardStore([shape('s')])
    store.change((els) => els.map((e) => ({ ...e, x: 5 })))
    store.applyRemote([])
    store.undo()
    expect(store.get()).toEqual([])
  })

  it('undoing an add removes it; undoing a delete restores it in place', () => {
    const store = createBoardStore([shape('a'), shape('b'), shape('c')])
    store.change((els) => els.filter((e) => e.id !== 'b'))
    store.change((els) => [...els, shape('new')])
    store.undo()
    expect(ids(store.get())).toEqual(['a', 'c'])
    store.undo()
    expect(ids(store.get())).toEqual(['a', 'b', 'c'])
  })

  it('reports every local change, including undo, but not remote ones', () => {
    const sent: Patch[] = []
    const store = createBoardStore([shape('a')], { onLocalChange: (p) => sent.push(p) })
    store.change((els) => [...els, shape('b')])
    store.applyRemote([...store.get(), shape('c')])
    store.undo()
    expect(sent.map((p) => [ids(p.upserts), p.deletes])).toEqual([
      [['b'], []],
      [[], ['b']],
    ])
  })

  it('discards a cancelled gesture without touching older steps', () => {
    const store = createBoardStore([shape('a')])
    store.change((els) => els.map((e) => ({ ...e, x: 1 })))
    store.checkpoint() // a gesture that never changed anything
    store.discardCheckpoint()
    expect(xOf(store.get(), 'a')).toBe(1)
    expect(store.canUndo()).toBe(true)
  })

  it('skips empty steps when undoing', () => {
    const store = createBoardStore([shape('a')])
    store.change((els) => els.map((e) => ({ ...e, x: 1 })))
    store.checkpoint()
    store.checkpoint()
    store.undo()
    expect(xOf(store.get(), 'a')).toBe(0)
  })
})
