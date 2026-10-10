import type { BoardElement, CurveElement, Point, Rect } from './types'

/**
 * Editing helpers for fitted curves. A curve's flat point list
 * [p0, c1, c2, p1, ...] is viewed as nodes: an anchor with an incoming and
 * outgoing handle. For an open curve the first node's `in` and the last
 * node's `out` are unused (equal to the anchor). A closed curve repeats its
 * first anchor at the end of the flat list; as nodes it is not repeated.
 */
export interface CurveNode {
  in: Point
  p: Point
  out: Point
}

export type NodePart = 'anchor' | 'in' | 'out'

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s })
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const normalize = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y)
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

export function toNodes(points: Point[], closed: boolean): CurveNode[] {
  const segments = (points.length - 1) / 3
  const count = closed ? segments : segments + 1
  const nodes: CurveNode[] = []
  for (let k = 0; k < count; k++) {
    const i = k * 3
    const p = points[i]
    const inHandle = i > 0 ? points[i - 1] : closed ? points[points.length - 2] : p
    const outHandle = i + 1 < points.length ? points[i + 1] : p
    nodes.push({ in: inHandle, p, out: outHandle })
  }
  return nodes
}

export function fromNodes(nodes: CurveNode[], closed: boolean): Point[] {
  const out: Point[] = [nodes[0].p]
  const segments = closed ? nodes.length : nodes.length - 1
  for (let s = 0; s < segments; s++) {
    const a = nodes[s]
    const b = nodes[(s + 1) % nodes.length]
    out.push(a.out, b.in, b.p)
  }
  return out
}

/** Whether a node's handles are collinear (a smooth, not a corner, point). */
export function isSmooth(node: CurveNode): boolean {
  const v1 = sub(node.p, node.in)
  const v2 = sub(node.out, node.p)
  const l1 = Math.hypot(v1.x, v1.y)
  const l2 = Math.hypot(v2.x, v2.y)
  if (l1 < 0.5 || l2 < 0.5) return false
  return (v1.x * v2.x + v1.y * v2.y) / (l1 * l2) > 0.985
}

/**
 * Move one part of a node to `target`. Moving the anchor carries its handles
 * along. With `mirror`, dragging a handle rotates the opposite handle to stay
 * collinear (keeping its length), so smooth points stay smooth.
 */
export function moveNodePart(
  points: Point[],
  closed: boolean,
  index: number,
  part: NodePart,
  target: Point,
  mirror: boolean,
): Point[] {
  const nodes = toNodes(points, closed)
  const n = { ...nodes[index] }
  if (part === 'anchor') {
    const d = sub(target, n.p)
    n.p = target
    n.in = add(n.in, d)
    n.out = add(n.out, d)
  } else {
    const other = part === 'in' ? 'out' : 'in'
    n[part] = target
    const len = dist(n[other], n.p)
    const dir = normalize(sub(n.p, target))
    if (mirror && len > 0.01 && (dir.x !== 0 || dir.y !== 0)) n[other] = add(n.p, scale(dir, len))
  }
  nodes[index] = n
  return fromNodes(nodes, closed)
}

/** Switch a node between smooth (collinear handles) and corner (handles aimed at its neighbors). */
export function toggleSmooth(points: Point[], closed: boolean, index: number): Point[] {
  const nodes = toNodes(points, closed)
  const n = nodes[index]
  const count = nodes.length
  const prev = closed || index > 0 ? nodes[(index - 1 + count) % count] : null
  const next = closed || index < count - 1 ? nodes[(index + 1) % count] : null

  if (isSmooth(n)) {
    nodes[index] = {
      p: n.p,
      in: prev ? lerp(n.p, prev.p, 1 / 3) : n.in,
      out: next ? lerp(n.p, next.p, 1 / 3) : n.out,
    }
  } else {
    const dir = normalize(
      prev && next ? sub(next.p, prev.p) : next ? sub(n.out, n.p) : prev ? sub(n.p, n.in) : { x: 1, y: 0 },
    )
    const lenIn = dist(n.in, n.p) || (prev ? dist(prev.p, n.p) / 3 : 0)
    const lenOut = dist(n.out, n.p) || (next ? dist(next.p, n.p) / 3 : 0)
    nodes[index] = {
      p: n.p,
      in: prev ? sub(n.p, scale(dir, lenIn)) : n.in,
      out: next ? add(n.p, scale(dir, lenOut)) : n.out,
    }
  }
  return fromNodes(nodes, closed)
}

/**
 * Remove a node; its neighbors are joined by one segment using their facing
 * handles. Returns null when too few nodes would remain to form a curve.
 */
export function deleteNode(points: Point[], closed: boolean, index: number): Point[] | null {
  const nodes = toNodes(points, closed)
  if (nodes.length <= 2) return null
  nodes.splice(index, 1)
  if (!closed) {
    // New ends have no outer handle.
    nodes[0] = { ...nodes[0], in: nodes[0].p }
    const last = nodes.length - 1
    nodes[last] = { ...nodes[last], out: nodes[last].p }
  }
  return fromNodes(nodes, closed)
}

/** Split segment `segment` at parameter t without changing the curve's shape (de Casteljau). */
export function splitSegment(
  points: Point[],
  closed: boolean,
  segment: number,
  t: number,
): { points: Point[]; index: number } {
  const nodes = toNodes(points, closed)
  const a = nodes[segment]
  const bi = (segment + 1) % nodes.length
  const b = nodes[bi]
  const p01 = lerp(a.p, a.out, t)
  const p12 = lerp(a.out, b.in, t)
  const p23 = lerp(b.in, b.p, t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const mid = lerp(p012, p123, t)
  nodes[segment] = { ...a, out: p01 }
  nodes[bi] = { ...nodes[bi], in: p23 }
  nodes.splice(segment + 1, 0, { in: p012, p: mid, out: p123 })
  return { points: fromNodes(nodes, closed), index: segment + 1 }
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t
  const w0 = mt * mt * mt
  const w1 = 3 * mt * mt * t
  const w2 = 3 * mt * t * t
  const w3 = t * t * t
  return {
    x: p0.x * w0 + p1.x * w1 + p2.x * w2 + p3.x * w3,
    y: p0.y * w0 + p1.y * w1 + p2.y * w2 + p3.y * w3,
  }
}

/** Closest point on the curve to `target`: which segment, at what t, and how far. */
export function nearestOnCurve(points: Point[], target: Point): { segment: number; t: number; distance: number } {
  let best = { segment: 0, t: 0, distance: Infinity }
  const steps = 40
  for (let s = 0; s * 3 + 3 < points.length; s++) {
    const [p0, p1, p2, p3] = points.slice(s * 3, s * 3 + 4)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const d = dist(cubicAt(p0, p1, p2, p3, t), target)
      if (d < best.distance) best = { segment: s, t, distance: d }
    }
  }
  // Refine around the best sample.
  const s = best.segment
  const [p0, p1, p2, p3] = points.slice(s * 3, s * 3 + 4)
  let lo = Math.max(0, best.t - 1 / steps)
  let hi = Math.min(1, best.t + 1 / steps)
  for (let i = 0; i < 30; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (dist(cubicAt(p0, p1, p2, p3, m1), target) < dist(cubicAt(p0, p1, p2, p3, m2), target)) hi = m2
    else lo = m1
  }
  const t = (lo + hi) / 2
  return { segment: s, t, distance: dist(cubicAt(p0, p1, p2, p3, t), target) }
}

/** Tight bounds of the drawn curve (sampled), rather than of its control points. */
export function curveBounds(points: Point[]): Rect {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  const visit = (p: Point) => {
    x1 = Math.min(x1, p.x)
    y1 = Math.min(y1, p.y)
    x2 = Math.max(x2, p.x)
    y2 = Math.max(y2, p.y)
  }
  visit(points[0])
  for (let s = 0; s * 3 + 3 < points.length; s++) {
    const [p0, p1, p2, p3] = points.slice(s * 3, s * 3 + 4)
    for (let i = 1; i <= 24; i++) visit(cubicAt(p0, p1, p2, p3, i / 24))
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Delete a node from a curve on the board; removes the curve if it would collapse. */
export function deleteNodeFromBoard(elements: BoardElement[], id: string, index: number): BoardElement[] {
  const el = elements.find((e): e is CurveElement => e.id === id && e.type === 'curve')
  if (!el) return elements
  const points = deleteNode(el.points, el.closed, index)
  if (!points) return elements.filter((e) => e.id !== id)
  return elements.map((e) => (e.id === id ? { ...el, points } : e))
}

export function nodeCount(el: CurveElement): number {
  return toNodes(el.points, el.closed).length
}
