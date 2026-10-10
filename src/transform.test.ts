import { describe, expect, it } from 'vitest'
import { boundaryPoint, center, getBounds, linePoints, shapeAt, toMap } from './geometry'
import { handleScale, resizeShape, rotateElements, scaleElements } from './transform'
import type { BoardElement, CurveElement, LineElement, PathElement, ShapeElement } from './types'

const shape = (id: string, over: Partial<ShapeElement> = {}): ShapeElement => ({
  id,
  type: 'shape',
  kind: 'rectangle',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 2,
  dash: 'solid',
  label: '',
  fontSize: 18,
  ...over,
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

const closeTo = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x)
  expect(a.y).toBeCloseTo(b.y)
}
const only = <T extends BoardElement>(els: BoardElement[], id: string) => els.find((e) => e.id === id) as T

describe('rotateElements', () => {
  it('rotates a shape about its own center by storing rotation', () => {
    const s = only<ShapeElement>(rotateElements([shape('a')], new Set(['a']), { x: 50, y: 25 }, Math.PI / 2), 'a')
    expect(s.rotation).toBeCloseTo(Math.PI / 2)
    closeTo(center(s), { x: 50, y: 25 })
    expect([s.w, s.h]).toEqual([100, 50])
  })

  it('orbits a shape around an outside pivot', () => {
    const s = only<ShapeElement>(rotateElements([shape('a')], new Set(['a']), { x: 0, y: 0 }, Math.PI / 2), 'a')
    closeTo(center(s), { x: -25, y: 50 })
  })

  it('wraps a full turn back to zero', () => {
    let els: BoardElement[] = [shape('a')]
    for (let i = 0; i < 4; i++) els = rotateElements(els, new Set(['a']), { x: 50, y: 25 }, Math.PI / 2)
    expect(only<ShapeElement>(els, 'a').rotation).toBe(0)
  })

  it('rotates path and curve points', () => {
    const path: PathElement = {
      id: 'p',
      type: 'path',
      points: [[10, 0, 0.5]],
      stroke: '#000',
      size: 4,
      opacity: 1,
      highlighter: false,
      simulatePressure: true,
    }
    const curve: CurveElement = {
      id: 'c',
      type: 'curve',
      points: [{ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
      closed: false,
      stroke: '#000',
      strokeWidth: 2,
      dash: 'solid',
      fill: 'none',
    }
    const out = rotateElements([path, curve], new Set(['p', 'c']), { x: 0, y: 0 }, Math.PI)
    const [x, y, pressure] = only<PathElement>(out, 'p').points[0]
    expect(x).toBeCloseTo(-10)
    expect(y).toBeCloseTo(0)
    expect(pressure).toBe(0.5)
    closeTo(only<CurveElement>(out, 'c').points[3], { x: -20, y: 0 })
  })

  it('keeps connector bindings when both shapes rotate, drops them otherwise', () => {
    const a = shape('a')
    const b = shape('b', { x: 300 })
    const l = line('l', { startBinding: 'a', endBinding: 'b' })
    const both = only<LineElement>(rotateElements([a, b, l], new Set(['a', 'b', 'l']), { x: 0, y: 0 }, 1), 'l')
    expect([both.startBinding, both.endBinding]).toEqual(['a', 'b'])
    const one = only<LineElement>(rotateElements([a, b, l], new Set(['a', 'l']), { x: 0, y: 0 }, 1), 'l')
    expect([one.startBinding, one.endBinding]).toEqual(['a', 'b'])
    const alone = only<LineElement>(rotateElements([a, b, l], new Set(['l']), { x: 0, y: 0 }, 1), 'l')
    expect([alone.startBinding, alone.endBinding]).toEqual(['a', 'b'])
  })

  it('keeps an attached end on its shape when only the line is scaled', () => {
    const a = shape('a')
    const l = line('l', { startBinding: 'a', end: { x: 300, y: 25 } })
    const scaled = only<LineElement>(scaleElements([a, l], new Set(['l']), { x: 0, y: 0 }, 2, 2), 'l')
    expect(scaled.startBinding).toBe('a')
    expect(scaled.end).toEqual({ x: 600, y: 50 }) // free end scaled
    const pts = linePoints(scaled, toMap([a, scaled]))
    expect(pts[0].x).toBeCloseTo(100) // still on a's right edge
  })
})

describe('scaleElements', () => {
  it('scales a shape box and position about a pivot', () => {
    const s = only<ShapeElement>(scaleElements([shape('a')], new Set(['a']), { x: 0, y: 0 }, 2, 3), 'a')
    expect([s.x, s.y, s.w, s.h]).toEqual([0, 0, 200, 150])
  })

  it('mirrors with negative factors using flips, not negative sizes', () => {
    const s = only<ShapeElement>(scaleElements([shape('a', { kind: 'triangle' })], new Set(['a']), { x: 50, y: 25 }, -1, 1), 'a')
    expect(s.flipX).toBe(true)
    expect(s.flipY).toBe(false)
    expect(s.w).toBe(100)
    closeTo(center(s), { x: 50, y: 25 })
  })

  it('negates rotation when a rotated shape is mirrored', () => {
    const s = only<ShapeElement>(
      scaleElements([shape('a', { rotation: 0.5 })], new Set(['a']), { x: 50, y: 25 }, -1, 1),
      'a',
    )
    expect(s.rotation).toBeCloseTo(-0.5)
  })

  it('grows free-standing text with its box', () => {
    const s = only<ShapeElement>(scaleElements([shape('t', { kind: 'text' })], new Set(['t']), { x: 0, y: 0 }, 2, 2), 't')
    expect(s.fontSize).toBe(36)
  })

  it('does not scale stroke widths', () => {
    const s = only<ShapeElement>(scaleElements([shape('a')], new Set(['a']), { x: 0, y: 0 }, 3, 3), 'a')
    expect(s.strokeWidth).toBe(2)
  })
})

describe('handleScale', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 }
  it('anchors a corner drag at the opposite corner', () => {
    expect(handleScale(box, 'se', { x: 200, y: 100 }, false)).toEqual({ sx: 2, sy: 2, anchor: { x: 0, y: 0 } })
    expect(handleScale(box, 'nw', { x: 50, y: 25 }, false)).toEqual({ sx: 0.5, sy: 0.5, anchor: { x: 100, y: 50 } })
  })
  it('scales only one axis from an edge', () => {
    const r = handleScale(box, 'e', { x: 300, y: 999 }, false)
    expect([r.sx, r.sy]).toEqual([3, 1])
  })
  it('flips when dragged past the anchor', () => {
    expect(handleScale(box, 'e', { x: -100, y: 0 }, false).sx).toBe(-1)
  })
  it('forces equal factors when uniform', () => {
    const r = handleScale(box, 'se', { x: 300, y: 60 }, true)
    expect(r.sx).toBe(r.sy)
    expect(r.sx).toBe(3)
  })
})

describe('rotated shape geometry', () => {
  const r = shape('r', { rotation: Math.PI / 2 }) // 100x50 box standing upright, center (50, 25)

  it('reports rotated bounds', () => {
    const b = getBounds(r, toMap([r]))
    closeTo({ x: b.x, y: b.y }, { x: 25, y: -25 })
    closeTo({ x: b.w, y: b.h }, { x: 50, y: 100 })
  })

  it('hit-tests in the rotated frame', () => {
    expect(shapeAt({ x: 50, y: -20 }, [r], null)?.id).toBe('r')
    expect(shapeAt({ x: 90, y: 25 }, [r], null)).toBeNull()
  })

  it('attaches connectors to the rotated outline', () => {
    closeTo(boundaryPoint(r, { x: 50, y: 500 }), { x: 50, y: 75 })
    const b = shape('b', { x: 40, y: 300, w: 20, h: 20 })
    const l = line('l', { startBinding: 'r', endBinding: 'b' })
    closeTo(linePoints(l, toMap([r, b, l]))[0], { x: 50, y: 75 })
  })

  it('resizes in the shape’s own frame, keeping the opposite side fixed', () => {
    // Local east edge of the upright box is at world y = 75; drag it down to y = 125.
    const out = resizeShape(r, 'e', { x: 50, y: 125 }, false)
    expect(out.w).toBeCloseTo(150)
    expect(out.h).toBeCloseTo(50)
    closeTo(center(out), { x: 50, y: 50 })
  })
})
