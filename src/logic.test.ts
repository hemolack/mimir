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

describe('attaching to the real outline', () => {
  const onSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 1e-6 &&
    Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6

  it('meets a triangle on its slanted side, not its bounding box', () => {
    const tri = shape('t', 0, 0, 100, 100, 'triangle') // apex (50,0), base y=100
    const p = boundaryPoint(tri, { x: 200, y: 50 }) // toward the right
    expect(onSegment(p, { x: 50, y: 0 }, { x: 100, y: 100 })).toBe(true)
    expect(p.x).toBeLessThan(100)
  })

  it('follows a flipped triangle', () => {
    const tri = { ...shape('t', 0, 0, 100, 100, 'triangle'), flipY: true } // apex at the bottom
    const p = boundaryPoint(tri, { x: 50, y: 500 })
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(100) // apex
  })

  it('meets a hexagon on its angled sides', () => {
    const hex = shape('h', 0, 0, 100, 50, 'hexagon') // points at (0,25) and (100,25)
    const p = boundaryPoint(hex, { x: 200, y: 25 + 100 }) // down-right
    expect(p.x).toBeLessThan(100)
    expect(onSegment(p, { x: 100, y: 25 }, { x: 75, y: 50 })).toBe(true)
  })

  it('starts elbow connectors on the real outline, level with the center', () => {
    const tri = shape('t', 0, 0, 100, 100, 'triangle')
    const target = shape('b', 400, 20, 40, 40)
    const l = line('l', { startBinding: 't', endBinding: 'b', routing: 'elbow' })
    const [start] = linePoints(l, toMap([tri, target, l]))
    expect(start.y).toBeCloseTo(50) // level with the triangle's center
    expect(start.x).toBeCloseTo(75) // on the slanted side, not the box edge at 100
  })

  it('meets a parallelogram on its slanted side', () => {
    const para = shape('p', 0, 0, 100, 50, 'parallelogram') // top from x=20, bottom to x=80
    const p = boundaryPoint(para, { x: 500, y: 25 })
    expect(onSegment(p, { x: 100, y: 0 }, { x: 80, y: 50 })).toBe(true)
  })
})

describe('shapeAt', () => {
  it('snaps within a margin around the shape', () => {
    const s = shape('s', 0, 0)
    expect(shapeAt({ x: 108, y: 25 }, [s], null)).toBeNull()
    expect(shapeAt({ x: 108, y: 25 }, [s], null, 12)?.id).toBe('s')
  })

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

  it('keeps both ends attached when the line moves, whether or not its shapes move', () => {
    const moved = translateElements([a, b, l], new Set(['a', 'l']), 10, 0)
    const ml = moved.find((el) => el.id === 'l') as LineElement
    expect(ml.startBinding).toBe('a')
    expect(ml.endBinding).toBe('b')
    // The stored fallback position moves with the line.
    expect(ml.end).toEqual({ x: 310, y: 25 })
  })

  it('slides an attached end around the perimeter when the line is moved alone', () => {
    const half = line('h', { startBinding: 'a', end: { x: 300, y: 25 } }) // attached at a, free end
    const before = linePoints(half, toMap([a, half]))[0]
    const moved = translateElements([a, half], new Set(['h']), 0, 200)[1] as LineElement
    const after = linePoints(moved, toMap([a, moved]))
    expect(before).toEqual({ x: 100, y: 25 }) // right edge, facing the free end
    expect(moved.startBinding).toBe('a')
    expect(after[1]).toEqual({ x: 300, y: 225 }) // free end moved
    // Attachment now faces down-right: on a's outline, bottom or right edge.
    expect(after[0].x === 100 || after[0].y === 50).toBe(true)
    expect(after[0]).not.toEqual(before)
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
