import { describe, expect, it } from 'vitest'
import { paintFor } from '../theme'
import type { BoardElement, CurveElement, LineElement, PathElement, ShapeElement } from '../types'
import { lineToolOptions, selectionOptions } from './optionItems'
import type { PickOption, ToggleOption } from './optionItems'

const shape = (over: Partial<ShapeElement> = {}): ShapeElement => ({
  id: 's', type: 'shape', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10, fill: '#ffffff', stroke: '#1e1e1e',
  strokeWidth: 2, dash: 'solid', label: '', fontSize: 18, ...over,
})
const line = (over: Partial<LineElement> = {}): LineElement => ({
  id: 'l', type: 'line', start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, startBinding: null, endBinding: null,
  startCap: 'none', endCap: 'triangle', routing: 'straight', stroke: '#1e1e1e', strokeWidth: 2, dash: 'solid',
  label: '', fontSize: 18, ...over,
})
const curve = (over: Partial<CurveElement> = {}): CurveElement => ({
  id: 'c', type: 'curve', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], closed: false,
  stroke: '#1e1e1e', strokeWidth: 2, dash: 'solid', fill: 'none', ...over,
})
const path = (over: Partial<PathElement> = {}): PathElement => ({
  id: 'p', type: 'path', points: [[0, 0, 0.5]], stroke: '#1e1e1e', size: 4, opacity: 1, highlighter: false,
  simulatePressure: true, ...over,
})

/** Build options for `selected`, recording what each pick does to `selected`. */
function setup(selected: BoardElement[]) {
  let result: BoardElement[] = selected
  const defaults: unknown[] = []
  const items = selectionOptions(selected, paintFor('light'), {
    patch: (fn, style) => {
      result = result.map(fn)
      if (style) defaults.push(style)
    },
    lineDefaults: (patch) => defaults.push(patch),
  })
  const pick = (id: string, value: string | number) => {
    ;(items.find((i) => i.id === id) as PickOption).onPick(value)
    return result
  }
  const toggle = (id: string) => {
    ;(items.find((i) => i.id === id) as ToggleOption).onToggle()
    return result
  }
  return { ids: items.map((i) => i.id), items, pick, toggle, defaults }
}

describe('selection options: what is offered', () => {
  it('shapes: color, fill, width, style, text size', () => {
    expect(setup([shape()]).ids).toEqual(['color', 'fill', 'width', 'dash', 'fontSize'])
  })
  it('free text: color and text size only', () => {
    expect(setup([shape({ kind: 'text', fill: 'none' })]).ids).toEqual(['color', 'fontSize'])
  })
  it('lines: color, width, style, ends, route, text size', () => {
    expect(setup([line()]).ids).toEqual(['color', 'width', 'dash', 'startCap', 'endCap', 'routing', 'fontSize'])
  })
  it('curves: fill only when closed', () => {
    expect(setup([curve()]).ids).toEqual(['color', 'width', 'dash'])
    expect(setup([curve({ closed: true })]).ids).toEqual(['color', 'fill', 'width', 'dash'])
  })
  it('brush strokes: color, size, highlighter', () => {
    expect(setup([path()]).ids).toEqual(['color', 'size', 'highlighter'])
  })
  it('mixed: the union of what applies', () => {
    expect(setup([shape(), path()]).ids).toEqual(['color', 'fill', 'width', 'dash', 'size', 'highlighter', 'fontSize'])
  })
  it('offers "double" only when every selected item is a line', () => {
    const dashValues = (els: BoardElement[]) => (setup(els).items.find((i) => i.id === 'dash') as PickOption).choices.map((c) => c.value)
    expect(dashValues([line()])).toContain('double')
    expect(dashValues([line(), shape()])).not.toContain('double')
  })
})

describe('selection options: what a pick changes', () => {
  it('color applies to everything and becomes the default', () => {
    const s = setup([shape(), path()])
    const out = s.pick('color', '#e03131')
    expect(out.map((e) => e.stroke)).toEqual(['#e03131', '#e03131'])
    expect(s.defaults).toContainEqual({ stroke: '#e03131' })
  })
  it('fill skips free text and open curves', () => {
    const out = setup([shape(), shape({ id: 't', kind: 'text', fill: 'none' }), curve()]).pick('fill', '#a5d8ff')
    expect((out[0] as ShapeElement).fill).toBe('#a5d8ff')
    expect((out[1] as ShapeElement).fill).toBe('none')
    expect((out[2] as CurveElement).fill).toBe('none')
  })
  it('width leaves brush strokes alone', () => {
    const out = setup([line(), path()]).pick('width', 6)
    expect((out[0] as LineElement).strokeWidth).toBe(6)
    expect(out[1]).toEqual(path())
  })
  it('line ends apply to lines and update the Line tool default', () => {
    const s = setup([line(), shape()])
    const out = s.pick('endCap', 'diamond-open')
    expect((out[0] as LineElement).endCap).toBe('diamond-open')
    expect(out[1]).toEqual(shape())
    expect(s.defaults).toContainEqual({ endCap: 'diamond-open' })
  })
  it('brush size respects highlighter strokes (which are drawn 3× wider)', () => {
    const out = setup([path(), path({ id: 'h', highlighter: true, size: 12, opacity: 0.4 })]).pick('size', 8)
    expect((out[0] as PathElement).size).toBe(8)
    expect((out[1] as PathElement).size).toBe(24)
  })
  it('highlighter toggle converts strokes both ways', () => {
    const on = setup([path()]).toggle('highlighter')[0] as PathElement
    expect([on.highlighter, on.opacity, on.size]).toEqual([true, 0.4, 12])
    const off = setup([on]).toggle('highlighter')[0] as PathElement
    expect([off.highlighter, off.opacity, off.size]).toEqual([false, 1, 4])
  })
})

describe('line tool options', () => {
  it('edits the tool defaults', () => {
    const changes: unknown[] = []
    const items = lineToolOptions({ dash: 'solid', startCap: 'none', endCap: 'triangle', routing: 'straight' }, (p) => changes.push(p))
    expect(items.map((i) => i.id)).toEqual(['dash', 'startCap', 'endCap', 'routing'])
    ;(items[3] as PickOption).onPick('curved-elbow')
    expect(changes).toEqual([{ routing: 'curved-elbow' }])
  })
})
