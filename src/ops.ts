import { FONT_FAMILY } from './constants'
import { linePoints, toMap } from './geometry'
import type { BoardElement, LineElement, Point } from './types'

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const isLabelable = (el: BoardElement | undefined): boolean =>
  el?.type === 'shape' || el?.type === 'line'

/**
 * Move elements by (dx, dy). Lines stay attached to their shapes even when the
 * shapes don't move: a bound end slides around the shape's perimeter to face
 * the line's new direction. (Dragging an end off a shape is how to detach it.)
 * Stored endpoints move too, as the fallback if a binding is later removed.
 */
export function translateElements(
  elements: BoardElement[],
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): BoardElement[] {
  const map = toMap(elements)
  return elements.map((el) => {
    if (!ids.has(el.id)) return el
    switch (el.type) {
      case 'shape':
        return { ...el, x: el.x + dx, y: el.y + dy }
      case 'path':
        return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p]) }
      case 'curve':
        return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
      case 'line': {
        const pts = linePoints(el, map)
        const s = pts[0]
        const e = pts[pts.length - 1]
        return { ...el, start: { x: s.x + dx, y: s.y + dy }, end: { x: e.x + dx, y: e.y + dy } }
      }
    }
  })
}

/** Remove elements; lines attached to removed shapes keep their current endpoints. */
export function removeElements(elements: BoardElement[], ids: ReadonlySet<string>): BoardElement[] {
  const map = toMap(elements)
  return elements
    .filter((el) => !ids.has(el.id))
    .map((el) => {
      if (el.type !== 'line') return el
      const dropStart = !!el.startBinding && ids.has(el.startBinding)
      const dropEnd = !!el.endBinding && ids.has(el.endBinding)
      if (!dropStart && !dropEnd) return el
      const pts = linePoints(el, map)
      return {
        ...el,
        start: dropStart ? pts[0] : el.start,
        end: dropEnd ? pts[pts.length - 1] : el.end,
        startBinding: dropStart ? null : el.startBinding,
        endBinding: dropEnd ? null : el.endBinding,
      }
    })
}

/** Store each line's resolved endpoints in start/end so it survives being copied. */
export function bakeLines(elements: BoardElement[], all: BoardElement[]): BoardElement[] {
  const map = toMap(all)
  return elements.map((el) => {
    if (el.type !== 'line') return el
    const pts = linePoints(el, map)
    return { ...el, start: pts[0], end: pts[pts.length - 1] }
  })
}

/**
 * Copy elements (already baked) with new ids, offset by `offset`. Bindings are
 * kept only between elements that are copied together.
 */
export function cloneElements(source: BoardElement[], offset: number): BoardElement[] {
  const idMap = new Map(source.map((el) => [el.id, newId()]))
  const shift = (p: Point): Point => ({ x: p.x + offset, y: p.y + offset })
  return source.map((el): BoardElement => {
    const id = idMap.get(el.id)!
    switch (el.type) {
      case 'shape':
        return { ...el, id, x: el.x + offset, y: el.y + offset }
      case 'path':
        return { ...el, id, points: el.points.map(([x, y, p]) => [x + offset, y + offset, p]) }
      case 'curve':
        return { ...el, id, points: el.points.map(shift) }
      case 'line':
        return {
          ...el,
          id,
          start: shift(el.start),
          end: shift(el.end),
          startBinding: (el.startBinding && idMap.get(el.startBinding)) || null,
          endBinding: (el.endBinding && idMap.get(el.endBinding)) || null,
        } satisfies LineElement
    }
  })
}

export function bringToFront(elements: BoardElement[], ids: ReadonlySet<string>): BoardElement[] {
  return [...elements.filter((el) => !ids.has(el.id)), ...elements.filter((el) => ids.has(el.id))]
}

export function sendToBack(elements: BoardElement[], ids: ReadonlySet<string>): BoardElement[] {
  return [...elements.filter((el) => ids.has(el.id)), ...elements.filter((el) => !ids.has(el.id))]
}

let measureCtx: CanvasRenderingContext2D | null = null

/** Size of a block of (unwrapped) text, used to fit free-standing text boxes. */
export function measureText(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split('\n')
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  let width = 0
  for (const line of lines) {
    if (measureCtx) {
      measureCtx.font = `${fontSize}px ${FONT_FAMILY}`
      width = Math.max(width, measureCtx.measureText(line).width)
    } else {
      width = Math.max(width, line.length * fontSize * 0.6)
    }
  }
  return { w: Math.ceil(width) + 16, h: Math.ceil(lines.length * fontSize * 1.25) + 10 }
}
