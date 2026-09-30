import { center, linePoints, resizeRect, rotateAround, toLocal, toMap } from './geometry'
import type { BoardElement, Point, Rect, ShapeElement } from './types'

/**
 * Rotate/scale/flip for any mix of elements. Point-based elements (lines,
 * brush strokes, curves) have their points transformed — Béziers stay exact
 * under affine maps. Shapes keep their box and store rotation/flip instead.
 * Stroke widths are not scaled.
 */

const TAU = Math.PI * 2
const normAngle = (a: number) => {
  const r = a % TAU
  return Math.abs(r) < 1e-9 || Math.abs(Math.abs(r) - TAU) < 1e-9 ? 0 : r
}

function mapElements(
  elements: BoardElement[],
  ids: ReadonlySet<string>,
  mapPoint: (p: Point) => Point,
  mapShape: (s: ShapeElement) => ShapeElement,
): BoardElement[] {
  const map = toMap(elements)
  return elements.map((el) => {
    if (!ids.has(el.id)) return el
    switch (el.type) {
      case 'shape':
        return mapShape(el)
      case 'path':
        return {
          ...el,
          points: el.points.map(([x, y, p]) => {
            const q = mapPoint({ x, y })
            return [q.x, q.y, p]
          }),
        }
      case 'curve':
        return { ...el, points: el.points.map(mapPoint) }
      case 'line': {
        // Like moving: ends stay attached to their shapes (the attachment point
        // slides along the perimeter); only free ends follow the transform.
        const pts = linePoints(el, map)
        return { ...el, start: mapPoint(pts[0]), end: mapPoint(pts[pts.length - 1]) }
      }
    }
  })
}

export function rotateElements(
  elements: BoardElement[],
  ids: ReadonlySet<string>,
  pivot: Point,
  angle: number,
): BoardElement[] {
  return mapElements(
    elements,
    ids,
    (p) => rotateAround(p, pivot, angle),
    (s) => {
      const c = rotateAround(center(s), pivot, angle)
      return { ...s, x: c.x - s.w / 2, y: c.y - s.h / 2, rotation: normAngle((s.rotation ?? 0) + angle) }
    },
  )
}

/**
 * Scale by (sx, sy) about `pivot`, in world axes. Negative factors mirror.
 * A rotated shape under non-uniform scale would really skew; it is
 * approximated by scaling its box along the mapped axes.
 */
export function scaleElements(
  elements: BoardElement[],
  ids: ReadonlySet<string>,
  pivot: Point,
  sx: number,
  sy: number,
): BoardElement[] {
  const mapPoint = (p: Point): Point => ({ x: pivot.x + (p.x - pivot.x) * sx, y: pivot.y + (p.y - pivot.y) * sy })
  return mapElements(elements, ids, mapPoint, (s) => {
    const theta = s.rotation ?? 0
    const ax = Math.abs(sx)
    const ay = Math.abs(sy)
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const w = Math.max(1, s.w * Math.hypot(ax * cos, ay * sin))
    const h = Math.max(1, s.h * Math.hypot(ax * sin, ay * cos))
    let rotation = theta === 0 ? 0 : Math.atan2(ay * sin, ax * cos)
    let flipX = !!s.flipX
    let flipY = !!s.flipY
    // Mirroring across a world axis = negate the rotation and mirror one local axis.
    if (sx < 0) {
      rotation = -rotation
      flipX = !flipX
    }
    if (sy < 0) {
      rotation = -rotation
      flipY = !flipY
    }
    const c = mapPoint(center(s))
    const next: ShapeElement = { ...s, x: c.x - w / 2, y: c.y - h / 2, w, h, rotation: normAngle(rotation), flipX, flipY }
    // Free-standing text grows with its box.
    if (s.kind === 'text') next.fontSize = Math.min(400, Math.max(4, Math.round(s.fontSize * Math.sqrt(ax * ay) * 10) / 10))
    return next
  })
}

/**
 * Resize a (possibly rotated) shape by one of its handles. The drag happens in
 * the shape's own frame, then the box is placed back so the opposite side stays put.
 */
export function resizeShape(shape: ShapeElement, handle: string, p: Point, lockAspect: boolean): Rect {
  const r = resizeRect(shape, handle, toLocal(shape, p), lockAspect)
  if (!shape.rotation) return r
  const c = rotateAround(center(r), center(shape), shape.rotation)
  return { ...r, x: c.x - r.w / 2, y: c.y - r.h / 2 }
}

/** Scale factors for dragging a selection-box handle from `from` to `to`, anchored at the opposite side. */
export function handleScale(box: Rect, handle: string, to: Point, uniform: boolean): { sx: number; sy: number; anchor: Point } {
  const anchor = {
    x: handle.includes('w') ? box.x + box.w : handle.includes('e') ? box.x : box.x + box.w / 2,
    y: handle.includes('n') ? box.y + box.h : handle.includes('s') ? box.y : box.y + box.h / 2,
  }
  const from = {
    x: handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.w : anchor.x,
    y: handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.h : anchor.y,
  }
  const clamp = (s: number) => (Math.abs(s) < 0.01 ? (s < 0 ? -0.01 : 0.01) : s)
  let sx = /[we]/.test(handle) && from.x !== anchor.x ? clamp((to.x - anchor.x) / (from.x - anchor.x)) : 1
  let sy = /[ns]/.test(handle) && from.y !== anchor.y ? clamp((to.y - anchor.y) / (from.y - anchor.y)) : 1
  if (uniform) {
    const horiz = /[we]/.test(handle)
    const vert = /[ns]/.test(handle)
    const s = horiz && vert ? (Math.abs(sx) >= Math.abs(sy) ? sx : sy) : horiz ? sx : sy
    sx = s
    sy = s
  }
  return { sx, sy, anchor }
}
