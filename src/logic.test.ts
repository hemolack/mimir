import { describe, expect, it } from 'vitest'
import { boundaryPoint, linePoints, polylineMidpoint, resizeRect, shapeAt, toMap } from './geometry'
import { bakeLines, cloneElements, removeElements, translateElements } from './ops'
import { parseBoardFile, sanitizeElements } from './storage'
import type { BoardElement, LineElement, ShapeElement } from './types'

const shape = (id: string, x: number, y: number, w = 100, h = 50, kind: ShapeElement['kind'] = 'rectangle'): ShapeElement => ({
  id,
  type: 'shape',
  kind,
  x,
  y,
  w,
  h,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 2,
  dash: 'solid',
  label: '',
  fontSize: 18,
})

const line = (id: string, over: Partial<LineElement> = {}): LineElement => ({
  id,
  type: 'line',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  startBinding: null,
  endBinding: null,
  startCap: 'none',
  endCap: 'arrow',
  routing: 'straight',
  stroke: '#000',
  strokeWidth: 2,
  dash: 'solid',
  label: '',
  fontSize: 18,
  ...over,
})

describe('boundaryPoint', () => {
  it('hits the right edge of a rectangle', () => {
    expect(boundaryPoint(shape('a', 0, 0, 100, 50), { x: 500, y: 25 })).toEqual({ x: 100, y: 25 })
  })
  it('hits a circle on its radius', () => {
    const p = boundaryPoint(shape('c', 0, 0, 100, 100, 'circle'), { x: 100, y: 100 })
    expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(50)
  })
  it('hits a diamond on its edge', () => {
    const p = boundaryPoint(shape('d', 0, 0, 100, 100, 'diamond'), { x: 100, y: 100 })
    expect(p.x).toBeCloseTo(75)
    expect(p.y).toBeCloseTo(75)
  })
})

describe('linePoints', () => {
  const a = shape('a', 0, 0)
  const b = shape('b', 300, 0)
  it('resolves bound ends to shape outlines', () => {
    const l = line('l', { startBinding: 'a', endBinding: 'b' })
    expect(linePoints(l, toMap([a, b, l]))).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ])
  })
  it('routes elbows through side midpoints', () => {
    const c = shape('c', 300, 200)
    const l = line('l', { startBinding: 'a', endBinding: 'c', routing: 'elbow' })
    expect(linePoints(l, toMap([a, c, l]))).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ])
  })
  it('falls back to stored points when the bound shape is missing', () => {
    const l = line('l', { startBinding: 'gone' })
    expect(linePoints(l, toMap([l]))[0]).toEqual({ x: 0, y: 0 })
  })
})

describe('polylineMidpoint', () => {
  it('finds the halfway point by length', () => {
    expect(
      polylineMidpoint([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 30 },
      ]),
    ).toEqual({ x: 10, y: 10 })
  })
})

describe('resizeRect', () => {
  it('drags the south-east corner', () => {
    expect(resizeRect({ x: 0, y: 0, w: 10, h: 10 }, 'se', { x: 30, y: 20 }, false)).toEqual({ x: 0, y: 0, w: 30, h: 20 })
  })
  it('flips when dragged past the opposite edge', () => {
    expect(resizeRect({ x: 0, y: 0, w: 10, h: 10 }, 'e', { x: -5, y: 3 }, false)).toEqual({ x: -5, y: 0, w: 5, h: 10 })
  })
  it('keeps squares square', () => {
    const r = resizeRect({ x: 0, y: 0, w: 10, h: 10 }, 'se', { x: 40, y: 20 }, true)
    expect(r.w).toBe(40)
    expect(r.h).toBe(40)
  })
})

describe('shapeAt', () => {
  it('returns the topmost shape', () => {
    const els = [shape('under', 0, 0), shape('over', 50, 0)]
    expect(shapeAt({ x: 60, y: 10 }, els, null)?.id).toBe('over')
    expect(shapeAt({ x: 60, y: 10 }, els, 'over')?.id).toBe('under')
  })
})

describe('element operations', () => {
  const a = shape('a', 0, 0)
  const b = shape('b', 300, 0)
  const l = line('l', { startBinding: 'a', endBinding: 'b' })

  it('keeps a binding when the shape moves with the line', () => {
    const moved = translateElements([a, b, l], new Set(['a', 'l']), 10, 0)
    const ml = moved.find((el) => el.id === 'l') as LineElement
    expect(ml.startBinding).toBe('a')
    expect(ml.endBinding).toBeNull()
    expect(ml.end).toEqual({ x: 310, y: 25 })
  })

  it('detaches lines from deleted shapes at their current position', () => {
    const left = removeElements([a, b, l], new Set(['b']))
    const ml = left.find((el) => el.id === 'l') as LineElement
    expect(left.map((el) => el.id)).toEqual(['a', 'l'])
    expect(ml.endBinding).toBeNull()
    expect(ml.end).toEqual({ x: 300, y: 25 })
  })

  it('clones with fresh ids and remapped bindings', () => {
    const all: BoardElement[] = [a, b, l]
    const copies = cloneElements(bakeLines([a, l], all), 20)
    const [ca, cl] = copies as [ShapeElement, LineElement]
    expect(ca.id).not.toBe('a')
    expect(ca.x).toBe(20)
    expect(cl.startBinding).toBe(ca.id)
    expect(cl.endBinding).toBeNull()
    expect(cl.end).toEqual({ x: 320, y: 45 })
  })
})

describe('storage validation', () => {
  it('drops malformed and duplicate elements', () => {
    const good = shape('a', 0, 0)
    const out = sanitizeElements([good, good, { id: 'x', type: 'shape' }, null, { id: 'p', type: 'path', points: [[1, 2, 0.5]], size: 4 }])
    expect(out.map((el) => el.id)).toEqual(['a', 'p'])
  })
  it('parses saved files and rejects junk', () => {
    expect(parseBoardFile(JSON.stringify({ elements: [shape('a', 0, 0)] }))).toHaveLength(1)
    expect(parseBoardFile('not json')).toBeNull()
  })
})
