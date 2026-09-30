import { describe, expect, it } from 'vitest'
import {
  curveBounds,
  deleteNode,
  deleteNodeFromBoard,
  fromNodes,
  isSmooth,
  moveNodePart,
  nearestOnCurve,
  splitSegment,
  toggleSmooth,
  toNodes,
} from './curveEdit'
import type { CurveElement, Point } from './types'

const P = (x: number, y: number): Point => ({ x, y })

// Open S-curve: two segments meeting smoothly at (100, 0).
const open: Point[] = [P(0, 0), P(0, -50), P(50, -50), P(100, 0), P(150, 50), P(200, 50), P(200, 0)]
// Closed loop of three segments.
const closed: Point[] = [P(0, 0), P(30, -30), P(70, -30), P(100, 0), P(100, 40), P(70, 80), P(50, 80), P(30, 80), P(0, 40), P(0, 0)]

function sample(points: Point[], n = 20): Point[] {
  const out: Point[] = []
  for (let s = 0; s * 3 + 3 < points.length; s++) {
    const [p0, p1, p2, p3] = points.slice(s * 3, s * 3 + 4)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const mt = 1 - t
      out.push(
        P(
          mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
          mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
        ),
      )
    }
  }
  return out
}

describe('nodes', () => {
  it('round-trips open and closed curves', () => {
    expect(fromNodes(toNodes(open, false), false)).toEqual(open)
    expect(fromNodes(toNodes(closed, true), true)).toEqual(closed)
    expect(toNodes(open, false)).toHaveLength(3)
    expect(toNodes(closed, true)).toHaveLength(3)
  })

  it('gives a closed curve’s first node the last segment’s handle', () => {
    expect(toNodes(closed, true)[0].in).toEqual(P(0, 40))
  })

  it('detects smooth points', () => {
    expect(isSmooth(toNodes(open, false)[1])).toBe(true)
    expect(isSmooth({ in: P(-10, 0), p: P(0, 0), out: P(0, 10) })).toBe(false)
  })
})

describe('moveNodePart', () => {
  it('moves an anchor together with its handles', () => {
    const moved = toNodes(moveNodePart(open, false, 1, 'anchor', P(110, 10), false), false)[1]
    expect(moved).toEqual({ in: P(60, -40), p: P(110, 10), out: P(160, 60) })
  })

  it('mirrors the opposite handle on smooth points, keeping its length', () => {
    const n = toNodes(moveNodePart(open, false, 1, 'out', P(100, 80), true), false)[1]
    expect(n.in.x).toBeCloseTo(100)
    expect(n.in.y).toBeCloseTo(-Math.hypot(50, 50))
    expect(isSmooth(n)).toBe(true)
  })

  it('moves a handle alone without mirroring', () => {
    const n = toNodes(moveNodePart(open, false, 1, 'out', P(100, 80), false), false)[1]
    expect(n.in).toEqual(P(50, -50))
  })

  it('keeps a closed curve closed when moving its first anchor', () => {
    const pts = moveNodePart(closed, true, 0, 'anchor', P(-10, 5), false)
    expect(pts[0]).toEqual(P(-10, 5))
    expect(pts[pts.length - 1]).toEqual(P(-10, 5))
  })
})

describe('toggleSmooth', () => {
  it('turns a smooth point into a corner and back', () => {
    // Arch whose top point is smooth (horizontal handles).
    const arch = [P(0, 0), P(0, -50), P(50, -100), P(100, -100), P(150, -100), P(200, -50), P(200, 0)]
    expect(isSmooth(toNodes(arch, false)[1])).toBe(true)
    const corner = toggleSmooth(arch, false, 1)
    expect(isSmooth(toNodes(corner, false)[1])).toBe(false)
    const smooth = toggleSmooth(corner, false, 1)
    expect(isSmooth(toNodes(smooth, false)[1])).toBe(true)
  })
})

describe('deleteNode', () => {
  it('joins the neighbors with their facing handles', () => {
    expect(deleteNode(open, false, 1)).toEqual([P(0, 0), P(0, -50), P(200, 50), P(200, 0)])
  })

  it('removes an end point of an open curve', () => {
    const pts = deleteNode(open, false, 0)!
    expect(pts[0]).toEqual(P(100, 0))
    expect(pts).toHaveLength(4)
  })

  it('refuses to collapse a curve below two points', () => {
    expect(deleteNode([P(0, 0), P(1, 1), P(2, 2), P(3, 3)], false, 0)).toBeNull()
  })

  it('deletes the whole curve from the board when it would collapse', () => {
    const el: CurveElement = {
      id: 'c',
      type: 'curve',
      points: [P(0, 0), P(1, 1), P(2, 2), P(3, 3)],
      closed: false,
      stroke: '#000',
      strokeWidth: 2,
      dash: 'solid',
      fill: 'none',
    }
    expect(deleteNodeFromBoard([el], 'c', 1)).toEqual([])
  })
})

describe('splitSegment', () => {
  it('adds a point without changing the shape', () => {
    const { points, index } = splitSegment(open, false, 0, 0.3)
    expect(index).toBe(1)
    expect(toNodes(points, false)).toHaveLength(4)
    const before = sample(open, 200)
    for (const p of sample(points)) {
      expect(Math.min(...before.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))).toBeLessThan(0.5)
    }
  })

  it('splits the closing segment of a closed curve', () => {
    const { points, index } = splitSegment(closed, true, 2, 0.5)
    expect(index).toBe(3)
    expect(toNodes(points, true)).toHaveLength(4)
    expect(points[points.length - 1]).toEqual(points[0])
  })
})

describe('nearestOnCurve', () => {
  it('finds the segment and parameter under a point', () => {
    const hit = nearestOnCurve(open, P(100, 0))
    expect(hit.distance).toBeLessThan(0.01)
    expect(hit.segment === 0 ? hit.t : 1 - hit.t).toBeGreaterThan(0.99)
  })
})

describe('curveBounds', () => {
  it('is tighter than the control points', () => {
    const b = curveBounds(open)
    expect(b.y).toBeGreaterThan(-50)
    expect(b.y).toBeLessThan(-30)
    expect(b.x).toBeCloseTo(0)
    expect(b.w).toBeCloseTo(200)
  })
})
