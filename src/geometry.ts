import { curveBounds } from './curveEdit'
import type {
  BoardElement,
  Cap,
  DashStyle,
  ElementMap,
  LineElement,
  Point,
  Rect,
  Routing,
  ShapeElement,
  ShapeKind,
} from './types'

export const LOCKED_ASPECT: ReadonlySet<ShapeKind> = new Set(['square', 'circle'])

export function toMap(elements: BoardElement[]): ElementMap {
  return new Map(elements.map((el) => [el.id, el]))
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function rectContains(r: Rect, p: Point, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w)
    y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function boundsOfPoints(points: Point[], pad: number): Rect {
  const r = unionRects(points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

// ---------- Shapes ----------

/** Outline of a shape as an SVG path in local coordinates (origin at top-left). */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  switch (kind) {
    case 'rounded': {
      const r = Math.min(16, w / 4, h / 4)
      return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`
    }
    case 'circle':
    case 'ellipse': {
      const rx = w / 2
      const ry = h / 2
      return `M0 ${ry} A${rx} ${ry} 0 1 0 ${w} ${ry} A${rx} ${ry} 0 1 0 0 ${ry} Z`
    }
    case 'diamond':
      return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`
    case 'triangle':
      return `M${w / 2} 0 L${w} ${h} L0 ${h} Z`
    case 'parallelogram': {
      const o = Math.min(w * 0.2, h)
      return `M${o} 0 H${w} L${w - o} ${h} H0 Z`
    }
    case 'hexagon': {
      const o = Math.min(w * 0.25, h / 2)
      return `M${o} 0 H${w - o} L${w} ${h / 2} L${w - o} ${h} H${o} L0 ${h / 2} Z`
    }
    case 'cylinder': {
      const rx = w / 2
      const ry = cylinderCap(w, h)
      return `M0 ${ry} A${rx} ${ry} 0 0 1 ${w} ${ry} V${h - ry} A${rx} ${ry} 0 0 1 0 ${h - ry} Z`
    }
    case 'document': {
      const a = h * 0.08
      return `M0 0 H${w} V${h - a} Q${w * 0.75} ${h - a * 3} ${w / 2} ${h - a} T0 ${h - a} Z`
    }
    default:
      return `M0 0 H${w} V${h} H0 Z`
  }
}

/** Extra interior strokes some shapes need (e.g. the front rim of a cylinder). */
export function shapeDetail(kind: ShapeKind, w: number, h: number): string | null {
  if (kind === 'cylinder') {
    const ry = cylinderCap(w, h)
    return `M0 ${ry} A${w / 2} ${ry} 0 0 0 ${w} ${ry}`
  }
  return null
}

function cylinderCap(w: number, h: number): number {
  return Math.min(h * 0.15, w * 0.25)
}

/** Region inside a shape where its label is laid out, in local coordinates. */
export function labelBox(kind: ShapeKind, w: number, h: number): Rect {
  switch (kind) {
    case 'diamond':
      return { x: w / 4, y: h / 4, w: w / 2, h: h / 2 }
    case 'triangle':
      return { x: w / 4, y: h / 2, w: w / 2, h: h / 2 }
    case 'circle':
    case 'ellipse':
      return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 }
    case 'parallelogram':
    case 'hexagon': {
      const o = Math.min(w * 0.2, h / 2)
      return { x: o, y: 0, w: w - o * 2, h }
    }
    case 'cylinder': {
      const ry = cylinderCap(w, h)
      return { x: 0, y: ry * 2, w, h: h - ry * 3 }
    }
    case 'document':
      return { x: 0, y: 0, w, h: h * 0.9 }
    default:
      return { x: 0, y: 0, w, h }
  }
}

// ---------- Rotation ----------

export function rotateAround(p: Point, pivot: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
}

/** Map a world point into the shape's unrotated frame (same origin as x/y/w/h). */
export function toLocal(shape: ShapeElement, p: Point): Point {
  return shape.rotation ? rotateAround(p, center(shape), -shape.rotation) : p
}

/** Inverse of toLocal. */
export function fromLocal(shape: ShapeElement, p: Point): Point {
  return shape.rotation ? rotateAround(p, center(shape), shape.rotation) : p
}

/** The shape's four corners in world space (nw, ne, se, sw). */
export function shapeCorners(shape: ShapeElement): Point[] {
  return [
    { x: shape.x, y: shape.y },
    { x: shape.x + shape.w, y: shape.y },
    { x: shape.x + shape.w, y: shape.y + shape.h },
    { x: shape.x, y: shape.y + shape.h },
  ].map((p) => fromLocal(shape, p))
}

/** Where a ray from the shape's center toward `toward` leaves its outline. */
export function boundaryPoint(shape: ShapeElement, toward: Point): Point {
  return fromLocal(shape, boundaryPointLocal(shape, toLocal(shape, toward)))
}

function boundaryPointLocal(shape: ShapeElement, toward: Point): Point {
  const c = center(shape)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const rx = Math.max(shape.w / 2, 0.5)
  const ry = Math.max(shape.h / 2, 0.5)
  const polygon = outlinePolygon(shape)
  if (polygon) {
    const t = rayExit(c, { x: dx, y: dy }, polygon)
    if (t !== null) return { x: c.x + dx * t, y: c.y + dy * t }
  }
  let t: number
  switch (shape.kind) {
    case 'circle':
    case 'ellipse':
      t = 1 / Math.hypot(dx / rx, dy / ry)
      break
    case 'diamond':
      t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
      break
    default:
      t = Math.min(dx === 0 ? Infinity : rx / Math.abs(dx), dy === 0 ? Infinity : ry / Math.abs(dy))
  }
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/**
 * Outline corners of polygonal shapes in the shape's unrotated frame (matching
 * `shapePath`), with flips applied. Null for shapes whose outline is handled
 * analytically (ellipses, diamond) or approximated by the box.
 */
function outlinePolygon(shape: ShapeElement): Point[] | null {
  const { w, h } = shape
  let pts: [number, number][]
  switch (shape.kind) {
    case 'triangle':
      pts = [
        [w / 2, 0],
        [w, h],
        [0, h],
      ]
      break
    case 'parallelogram': {
      const o = Math.min(w * 0.2, h)
      pts = [
        [o, 0],
        [w, 0],
        [w - o, h],
        [0, h],
      ]
      break
    }
    case 'hexagon': {
      const o = Math.min(w * 0.25, h / 2)
      pts = [
        [o, 0],
        [w - o, 0],
        [w, h / 2],
        [w - o, h],
        [o, h],
        [0, h / 2],
      ]
      break
    }
    default:
      return null
  }
  return pts.map(([x, y]) => ({
    x: shape.x + (shape.flipX ? w - x : x),
    y: shape.y + (shape.flipY ? h - y : y),
  }))
}

/** Smallest t > 0 where the ray origin + t·dir crosses the polygon's edges (null if it doesn't). */
function rayExit(origin: Point, dir: Point, polygon: Point[]): number | null {
  const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
  let best: number | null = null
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const edge = { x: b.x - a.x, y: b.y - a.y }
    const denom = cross(dir, edge)
    if (Math.abs(denom) < 1e-12) continue // parallel
    const ao = { x: a.x - origin.x, y: a.y - origin.y }
    const t = cross(ao, edge) / denom
    const u = cross(ao, dir) / denom
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t
  }
  return best
}

/**
 * Where an elbow connector leaves a shape: straight out from the center toward
 * the side facing `toward`, stopping at the real outline (so a triangle's
 * slanted side or a hexagon's point, not the bounding box).
 */
function sideAnchor(shape: ShapeElement, toward: Point, horizontal: boolean): Point {
  const c = center(shape)
  const t = toLocal(shape, toward)
  const side = horizontal
    ? { x: t.x >= c.x ? shape.x + shape.w : shape.x, y: c.y }
    : { x: c.x, y: t.y >= c.y ? shape.y + shape.h : shape.y }
  return fromLocal(shape, boundaryPointLocal(shape, side))
}

/** Resize a rect by dragging one of its 8 handles (n, ne, e, se, s, sw, w, nw). */
export function resizeRect(orig: Rect, handle: string, p: Point, lockAspect: boolean): Rect {
  let x1 = orig.x
  let y1 = orig.y
  let x2 = orig.x + orig.w
  let y2 = orig.y + orig.h
  if (handle.includes('w')) x1 = p.x
  if (handle.includes('e')) x2 = p.x
  if (handle.includes('n')) y1 = p.y
  if (handle.includes('s')) y2 = p.y

  if (lockAspect) {
    const horiz = /[we]/.test(handle)
    const vert = /[ns]/.test(handle)
    const size =
      horiz && vert
        ? Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
        : horiz
          ? Math.abs(x2 - x1)
          : Math.abs(y2 - y1)
    const sw = Math.sign(x2 - x1) || 1
    const sh = Math.sign(y2 - y1) || 1
    if (handle.includes('w')) x1 = x2 - size * sw
    else if (handle.includes('e')) x2 = x1 + size * sw
    else {
      const cx = (x1 + x2) / 2
      x1 = cx - size / 2
      x2 = cx + size / 2
    }
    if (handle.includes('n')) y1 = y2 - size * sh
    else if (handle.includes('s')) y2 = y1 + size * sh
    else {
      const cy = (y1 + y2) / 2
      y1 = cy - size / 2
      y2 = cy + size / 2
    }
  }
  const r = normalizeRect({ x: x1, y: y1 }, { x: x2, y: y2 })
  return { ...r, w: Math.max(r.w, 2), h: Math.max(r.h, 2) }
}

/** Topmost shape under `p` (used for connecting lines to shapes). */
export function shapeAt(
  p: Point,
  elements: BoardElement[],
  excludeId: string | null,
  pad = 0,
): ShapeElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    if (el.type === 'shape' && el.id !== excludeId && rectContains(el, toLocal(el, p), pad)) return el
  }
  return null
}

// ---------- Lines ----------

function boundShape(id: string | null, map: ElementMap): ShapeElement | null {
  const el = id ? map.get(id) : undefined
  return el?.type === 'shape' ? el : null
}

function dedupe(points: Point[]): Point[] {
  return points.filter(
    (p, i) => i === 0 || Math.abs(p.x - points[i - 1].x) > 0.01 || Math.abs(p.y - points[i - 1].y) > 0.01,
  )
}

/** The rendered polyline of a line, with bound ends resolved against their shapes. */
export function linePoints(line: LineElement, map: ElementMap): Point[] {
  const a = boundShape(line.startBinding, map)
  const b = boundShape(line.endBinding, map)
  const refA = a ? center(a) : line.start
  const refB = b ? center(b) : line.end

  if (line.routing === 'elbow' || line.routing === 'curved-elbow') {
    const horizontal = Math.abs(refB.x - refA.x) >= Math.abs(refB.y - refA.y)
    const s = a ? sideAnchor(a, refB, horizontal) : line.start
    const e = b ? sideAnchor(b, refA, horizontal) : line.end
    if (horizontal) {
      const mx = (s.x + e.x) / 2
      return dedupe([s, { x: mx, y: s.y }, { x: mx, y: e.y }, e])
    }
    const my = (s.y + e.y) / 2
    return dedupe([s, { x: s.x, y: my }, { x: e.x, y: my }, e])
  }

  const s = a ? boundaryPoint(a, refB) : line.start
  const e = b ? boundaryPoint(b, refA) : line.end
  return [s, e]
}

/** Point halfway along a polyline, measured by length. */
export function polylineMidpoint(points: Point[]): Point {
  if (points.length === 1) return points[0]
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(remaining / lengths[i], 1)
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      }
    }
    remaining -= lengths[i]
  }
  return points[0]
}

export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
}

/** Corner radius for curved-elbow lines. */
export const ELBOW_RADIUS = 16

/**
 * SVG path for a polyline with rounded corners. Each corner's radius shrinks to
 * fit so corners never overlap: a middle segment is shared by two corners (each
 * may use half of it); an end segment belongs to one corner (it may use all of it).
 * `offset` is for the rails of a double line: the rail on the outside of a turn
 * gets a larger radius and the inside one a smaller one, keeping them concentric.
 */
export function roundedPath(points: Point[], radius: number, offset = 0): string {
  if (points.length < 3) return polylinePath(points)
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const l1 = Math.hypot(b.x - a.x, b.y - a.y)
    const l2 = Math.hypot(c.x - b.x, c.y - b.y)
    if (l1 === 0 || l2 === 0) continue
    // Screen coordinates (y down): cross > 0 is a clockwise (right) turn, whose outside is the left (+offset) side.
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    const turn = cross > 0 ? 1 : cross < 0 ? -1 : 0
    const max1 = i === 1 ? l1 : l1 / 2
    const max2 = i === points.length - 2 ? l2 : l2 / 2
    const r = Math.max(0, Math.min(radius + turn * offset, max1, max2))
    const p1 = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r }
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r }
    d += ` L${p1.x} ${p1.y} Q${b.x} ${b.y} ${p2.x} ${p2.y}`
  }
  const last = points[points.length - 1]
  return `${d} L${last.x} ${last.y}`
}

/** The SVG path for a line's (already routed) points, rounding corners for curved elbows. */
export function linePath(points: Point[], routing: Routing, offset = 0): string {
  return routing === 'curved-elbow' ? roundedPath(points, ELBOW_RADIUS, offset) : polylinePath(points)
}

/**
 * How a cap is painted: 'stroke' = filled with the line color, 'paper' = hollow
 * (filled white so the line underneath doesn't show through), 'none' = outline only.
 */
export type CapFill = 'stroke' | 'paper' | 'none'
export const PAPER = '#ffffff'

/** Geometry for an arrowhead/cap at `tip`, pointing away from `from`. */
export function capPath(cap: Cap, tip: Point, from: Point, strokeWidth: number): { d: string; fill: CapFill } | null {
  if (cap === 'none') return null
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const len = 8 + strokeWidth * 3
  const at = (a: number, l: number): Point => ({
    x: tip.x - l * Math.cos(a),
    y: tip.y - l * Math.sin(a),
  })
  const spread = 0.45
  const hollow = cap.endsWith('-open')
  switch (cap) {
    case 'arrow': {
      const p1 = at(angle - spread, len)
      const p2 = at(angle + spread, len)
      return { d: `M${p1.x} ${p1.y} L${tip.x} ${tip.y} L${p2.x} ${p2.y}`, fill: 'none' }
    }
    case 'triangle':
    case 'triangle-open': {
      const p1 = at(angle - spread, len)
      const p2 = at(angle + spread, len)
      return { d: `M${tip.x} ${tip.y} L${p1.x} ${p1.y} L${p2.x} ${p2.y} Z`, fill: hollow ? 'paper' : 'stroke' }
    }
    case 'circle':
    case 'circle-open': {
      const r = 3 + strokeWidth * 1.2
      const c = at(angle, r)
      return {
        d: `M${c.x - r} ${c.y} A${r} ${r} 0 1 0 ${c.x + r} ${c.y} A${r} ${r} 0 1 0 ${c.x - r} ${c.y} Z`,
        fill: hollow ? 'paper' : 'stroke',
      }
    }
    case 'diamond':
    case 'diamond-open': {
      const back = at(angle, len * 1.2)
      const mid = at(angle, len * 0.6)
      const nx = -Math.sin(angle) * len * 0.35
      const ny = Math.cos(angle) * len * 0.35
      return {
        d: `M${tip.x} ${tip.y} L${mid.x + nx} ${mid.y + ny} L${back.x} ${back.y} L${mid.x - nx} ${mid.y - ny} Z`,
        fill: hollow ? 'paper' : 'stroke',
      }
    }
    case 'bar': {
      const half = len * 0.45
      const nx = -Math.sin(angle) * half
      const ny = Math.cos(angle) * half
      return { d: `M${tip.x + nx} ${tip.y + ny} L${tip.x - nx} ${tip.y - ny}`, fill: 'none' }
    }
  }
}

/**
 * How far back from the tip the line itself should stop for a cap, so it meets
 * the cap's back edge instead of running through (and, for double lines, past)
 * a closed shape. Open strokes (arrow, bar) keep the line going to the tip.
 */
export function capInset(cap: Cap, strokeWidth: number): number {
  const len = 8 + strokeWidth * 3
  switch (cap) {
    case 'triangle':
    case 'triangle-open':
      return len * Math.cos(0.45)
    case 'circle':
    case 'circle-open':
      return (3 + strokeWidth * 1.2) * 2
    case 'diamond':
    case 'diamond-open':
      return len * 1.2
    default:
      return 0
  }
}

/** The polyline with `start` and `end` lengths cut off its ends (never past its middle). */
export function trimPolyline(points: Point[], start: number, end: number): Point[] {
  if (points.length < 2 || (start <= 0 && end <= 0)) return points
  const total = points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)
  const limit = total * 0.49
  const cut = (pts: Point[], amount: number): Point[] => {
    let remaining = Math.min(amount, limit)
    const out = [...pts]
    while (remaining > 0 && out.length > 1) {
      const [a, b] = out
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      if (seg > remaining) {
        const t = remaining / seg
        out[0] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        break
      }
      remaining -= seg
      out.shift()
    }
    return out
  }
  return cut(cut(points, start).reverse(), end).reverse()
}

/** Resolve a cap's fill kind to a paint value. */
export const capFillColor = (fill: CapFill, stroke: string) => (fill === 'stroke' ? stroke : fill === 'paper' ? PAPER : 'none')

/**
 * The polyline shifted sideways by `offset` (positive = left of travel), with
 * mitred corners. Used to draw the two rails of a double line.
 */
export function offsetPolyline(points: Point[], offset: number): Point[] {
  const normals = points.slice(1).map((p, i) => {
    const dx = p.x - points[i].x
    const dy = p.y - points[i].y
    const len = Math.hypot(dx, dy) || 1
    return { x: dy / len, y: -dx / len }
  })
  if (normals.length === 0) return points
  return points.map((p, i) => {
    const n1 = normals[Math.max(0, i - 1)]
    const n2 = normals[Math.min(normals.length - 1, i)]
    const mx = n1.x + n2.x
    const my = n1.y + n2.y
    const ml = Math.hypot(mx, my)
    if (ml < 1e-6) return { x: p.x + n1.x * offset, y: p.y + n1.y * offset } // reversal: no sensible miter
    const m = { x: mx / ml, y: my / ml }
    // Stretch the miter so both rails stay `offset` from each segment (capped for sharp angles).
    const scale = offset / Math.max(m.x * n1.x + m.y * n1.y, 0.25)
    return { x: p.x + m.x * scale, y: p.y + m.y * scale }
  })
}

/** Rail geometry for a double line of the given stroke width. */
export function doubleRails(strokeWidth: number) {
  return { railWidth: Math.max(1, strokeWidth * 0.6), offset: strokeWidth * 0.8 + 1 }
}

// ---------- Misc ----------

export function dashArray(dash: DashStyle, width: number): string | undefined {
  if (dash === 'dashed') return `${width * 4} ${width * 3}`
  if (dash === 'dotted') return `0 ${width * 2.5}`
  return undefined
}

export function getBounds(el: BoardElement, map: ElementMap): Rect {
  switch (el.type) {
    case 'shape':
      return el.rotation ? boundsOfPoints(shapeCorners(el), 0) : { x: el.x, y: el.y, w: el.w, h: el.h }
    case 'line':
      return boundsOfPoints(linePoints(el, map), el.strokeWidth + 6)
    case 'path':
      return boundsOfPoints(
        el.points.map(([x, y]) => ({ x, y })),
        el.size / 2,
      )
    case 'curve': {
      const r = curveBounds(el.points)
      const pad = el.strokeWidth / 2 + 2
      return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
    }
  }
}

/** Snap the vector a→b to the nearest 15° increment. */
export function snapAngle(a: Point, b: Point): Point {
  const step = Math.PI / 12
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len }
}

/** Outline path for perfect-freehand output (from its README). */
export function svgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return ''
  const d: (string | number)[] = ['M', stroke[0][0], stroke[0][1], 'Q']
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i]
    const [x1, y1] = stroke[(i + 1) % stroke.length]
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  d.push('Z')
  return d.join(' ')
}
