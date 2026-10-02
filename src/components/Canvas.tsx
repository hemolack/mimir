import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { MAX_ZOOM, MIN_ZOOM } from '../constants'
import {
  center,
  fromLocal,
  getBounds,
  LOCKED_ASPECT,
  linePoints,
  normalizeRect,
  rectsIntersect,
  shapeAt,
  shapeCorners,
  snapAngle,
  toMap,
  unionRects,
} from '../geometry'
import { isLabelable, measureText, newId, removeElements, translateElements } from '../ops'
import { handleScale, resizeShape, rotateElements, scaleElements } from '../transform'
import type { Board } from '../useBoard'
import {
  deleteNodeFromBoard,
  isSmooth,
  moveNodePart,
  nearestOnCurve,
  splitSegment,
  toggleSmooth,
  toNodes,
} from '../curveEdit'
import type { NodePart } from '../curveEdit'
import { strokeToCurve } from '../curveFit'
import type { PeerPresence } from '../protocol'
import { usePaint } from '../theme'
import type {
  BoardElement,
  CurveElement,
  LineElement,
  LineStyle,
  PathElement,
  PenSettings,
  Point,
  Rect,
  ShapeElement,
  ShapeKind,
  StyleDefaults,
  Tool,
  Viewport,
} from '../types'
import { ContextMenu } from './ContextMenu'
import { CurveView, LineView, PathView, ShapeView } from './ElementViews'
import { LabelEditor } from './LabelEditor'

export interface Editing {
  id: string
  initialText?: string
}

export interface ActiveNode {
  id: string
  index: number
}

export interface SelectionActions {
  patch(fn: (el: BoardElement) => BoardElement, style?: Partial<StyleDefaults>): void
  duplicate(): void
  remove(): void
  front(): void
  back(): void
  rotate90(): void
  flip(axis: 'x' | 'y'): void
}

interface CanvasProps {
  board: Board
  viewport: Viewport
  onViewport(v: Viewport): void
  tool: Tool
  onTool(t: Tool): void
  shapeKind: ShapeKind
  lineStyle: LineStyle
  pen: PenSettings
  style: StyleDefaults
  selectedIds: string[]
  onSelect(ids: string[]): void
  editing: Editing | null
  onEdit(e: Editing | null): void
  /** The curve point chosen for editing (its handles are shown). */
  activeNode: ActiveNode | null
  onActiveNode(n: ActiveNode | null): void
  spaceHeld: boolean
  actions: SelectionActions
  svgRef: React.RefObject<SVGSVGElement | null>
  /** Other people on this board (shared boards only). */
  peers: PeerPresence[]
  /** Reports this user's pointer in world coordinates (shared boards only). */
  onCursor?(p: Point | null): void
}

/**
 * Replace just the `ids` elements in the live board with their versions from
 * `source`. Gestures compute from a snapshot taken at the start; merging only
 * what they touch keeps collaborators' concurrent changes (and deletions) intact.
 */
function mergeFrom(els: BoardElement[], source: BoardElement[], ids: ReadonlySet<string>): BoardElement[] {
  const updated = new Map(source.filter((el) => ids.has(el.id)).map((el) => [el.id, el]))
  return els.map((el) => updated.get(el.id) ?? el)
}

type Gesture = { pointerId: number; checkpointed: boolean } & (
  | { kind: 'pan'; startScreen: Point; startVp: Viewport }
  | { kind: 'pinch'; ids: [number, number]; startDist: number; startMid: Point; startVp: Viewport }
  | { kind: 'create-shape'; id: string; origin: Point }
  | { kind: 'create-line'; id: string; origin: Point }
  | { kind: 'draw'; id: string }
  | { kind: 'draw-curve'; points: Point[] }
  | { kind: 'erase'; last: Point }
  | {
      kind: 'move'
      origin: Point
      originScreen: Point
      ids: Set<string>
      snapshot: BoardElement[]
      moved: boolean
      /** Move tool: a tap on empty space (no drag) clears the selection. */
      clearOnTap?: boolean
    }
  | {
      kind: 'transform'
      mode: 'rotate' | 'scale' | 'box'
      origin: Point
      originScreen: Point
      ids: Set<string>
      snapshot: BoardElement[]
      pivot: Point
      moved: boolean
      clearOnTap: boolean
      /** Item under the pointer to select instead, if this turns out to be a tap. */
      tapSelect?: string | null
      /** For 'box': which selection-box handle, and the box at the start. */
      handle?: string
      box?: Rect
    }
  | { kind: 'pivot' }
  | { kind: 'resize'; id: string; handle: string; original: ShapeElement }
  | { kind: 'line-end'; id: string; end: 'start' | 'end' }
  | { kind: 'node'; id: string; index: number; part: NodePart; original: CurveElement; mirror: boolean }
  | { kind: 'marquee'; origin: Point; base: string[] }
)

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const COMPASS_CURSORS = ['ns', 'nesw', 'ew', 'nwse', 'ns', 'nesw', 'ew', 'nwse']
/** Resize cursor for a handle, turned to match the shape's rotation. */
const handleCursor = (handle: string, rotation: number) => {
  const steps = Math.round(rotation / (Math.PI / 4))
  const i = (((COMPASS.indexOf(handle) + steps) % 8) + 8) % 8
  return `${COMPASS_CURSORS[i]}-resize`
}
const DOUBLE_TAP_MS = 350
/** A line end attaches to a shape when dropped within this many screen pixels of it. */
const SNAP_PX = 12

/** Stop mousedown from moving focus, which would instantly blur a label editor opened on pointerdown. */
const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault()
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5)
/** All the samples since the last event (browsers batch fast pointer moves). */
const coalesced = (e: PointerEvent): PointerEvent[] => {
  const events = e.getCoalescedEvents?.() ?? []
  return events.length ? events : [e]
}

export function Canvas(props: CanvasProps) {
  const { board, viewport, tool, selectedIds, editing, svgRef } = props
  const paint = usePaint()
  const wrapRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef(viewport)
  vpRef.current = viewport
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const lastTap = useRef({ time: 0, id: null as string | null, x: 0, y: 0 })
  const penSeen = useRef(false)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [bindTarget, setBindTarget] = useState<string | null>(null)
  /** Raw points of a curve being drawn, shown until it is fitted. */
  const [draft, setDraft] = useState<Point[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  /** Custom pivot for scale/rotate; tied to the selection it was set for. */
  const [pivotState, setPivotState] = useState<{ key: string; p: Point } | null>(null)
  /** Live readout (angle / percent) shown next to the pointer while transforming. */
  const [hud, setHud] = useState<{ x: number; y: number; text: string } | null>(null)

  const elements = board.elements
  const map = useMemo(() => toMap(elements), [elements])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const setViewport = (v: Viewport) => {
    vpRef.current = v
    props.onViewport(v)
  }

  // Wheel: pan, or zoom around the cursor with Ctrl/⌘ (also trackpad pinch).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const vp = vpRef.current
      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const zoom = clampZoom(vp.zoom * Math.exp(-e.deltaY * 0.01))
        const wx = (sx - vp.x) / vp.zoom
        const wy = (sy - vp.y) / vp.zoom
        setViewport({ zoom, x: sx - wx * zoom, y: sy - wy * zoom })
      } else {
        setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY })
      }
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const toScreen = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toWorld = (p: Point): Point => {
    const vp = vpRef.current
    return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom }
  }

  const begin = (g: Gesture) => {
    gesture.current = g
    setBusy(true)
  }

  /** Apply a change during a gesture, recording one undo step for the whole gesture. */
  const mutate = (fn: (els: BoardElement[]) => BoardElement[]) => {
    const g = gesture.current
    if (g && !g.checkpointed) {
      board.checkpoint()
      g.checkpointed = true
    }
    board.update(fn)
  }

  const updateEl = <T extends BoardElement>(id: string, fn: (el: T) => T) =>
    mutate((els) => els.map((el) => (el.id === id ? fn(el as T) : el)))

  const createText = (at: Point) => {
    const fontSize = props.style.fontSize
    const el: ShapeElement = {
      id: newId(),
      type: 'shape',
      kind: 'text',
      x: at.x - 8,
      y: at.y - fontSize * 0.75,
      w: 160,
      h: fontSize * 1.25 + 10,
      fill: 'none',
      stroke: props.style.stroke,
      strokeWidth: props.style.strokeWidth,
      dash: 'solid',
      label: '',
      fontSize,
    }
    board.change((els) => [...els, el])
    props.onSelect([el.id])
    props.onEdit({ id: el.id })
    props.onTool('select')
  }

  const eraseAlong = (a: Point, b: Point) => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5))
    const hit = new Set<string>()
    for (let i = 0; i <= steps; i++) {
      const x = rect.left + a.x + ((b.x - a.x) * i) / steps
      const y = rect.top + a.y + ((b.y - a.y) * i) / steps
      for (const node of document.elementsFromPoint(x, y)) {
        if (!svg.contains(node)) continue
        const id = node.closest('[data-id]')?.getAttribute('data-id')
        if (id) hit.add(id)
      }
    }
    if (hit.size) {
      mutate((els) => removeElements(els, hit))
      if (selectedIds.some((id) => hit.has(id))) props.onSelect(selectedIds.filter((id) => !hit.has(id)))
    }
  }

  const startPinch = () => {
    const g = gesture.current
    // A second finger turns whatever the first finger started into a pinch.
    if (g && g.checkpointed && g.kind !== 'pan') board.discardCheckpoint()
    const [[idA, a], [idB, b]] = [...pointers.current.entries()]
    begin({
      kind: 'pinch',
      pointerId: idA,
      checkpointed: false,
      ids: [idA, idB],
      startDist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startVp: vpRef.current,
    })
    setMarquee(null)
    setBindTarget(null)
    setDraft(null)
    setHud(null)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // The canvas never takes focus (see onMouseDown), so commit an open label edit explicitly.
    if (editing && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const sp = toScreen(e)
    if (e.pointerType === 'pen') penSeen.current = true
    pointers.current.set(e.pointerId, sp)
    try {
      svgRef.current!.setPointerCapture(e.pointerId)
    } catch {
      // Pointer already gone (e.g. a very quick tap); nothing to capture.
    }

    if (e.pointerType === 'touch' && pointers.current.size === 2) {
      startPinch()
      return
    }
    if (gesture.current) return
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return

    const wp = toWorld(sp)
    const target = e.target as Element
    const hitId = target.closest('[data-id]')?.getAttribute('data-id') ?? null
    const base = { pointerId: e.pointerId, checkpointed: false }

    // Once a stylus has been used, fingers only navigate while drawing (palm rejection).
    const palm =
      e.pointerType === 'touch' && penSeen.current && (tool === 'pen' || tool === 'curve' || tool === 'eraser')
    if (e.button === 1 || tool === 'hand' || props.spaceHeld || palm) {
      begin({ ...base, kind: 'pan', startScreen: sp, startVp: vpRef.current })
      return
    }

    // Stylus eraser end (or eraser barrel button).
    if (tool === 'eraser' || (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0))) {
      begin({ ...base, kind: 'erase', last: sp })
      eraseAlong(sp, sp)
      return
    }

    switch (tool) {
      case 'move':
      case 'scale':
      case 'rotate': {
        const handle = target.closest('[data-handle]')
        if (handle) {
          const h = handle.getAttribute('data-handle')!
          const id = handle.getAttribute('data-for')
          const el = id ? map.get(id) : undefined
          if (h === 'pivot') {
            begin({ ...base, kind: 'pivot' })
          } else if (h === 'box' && selectionBounds && pivot) {
            begin({
              ...base,
              kind: 'transform',
              mode: 'box',
              handle: handle.getAttribute('data-pos')!,
              box: selectionBounds,
              origin: wp,
              originScreen: sp,
              ids: new Set(selectedIds),
              snapshot: board.get(),
              pivot,
              moved: false,
              clearOnTap: false,
            })
          } else if (el?.type === 'shape' && id) {
            begin({ ...base, kind: 'resize', id, handle: h, original: el })
          }
          return
        }
        let sel = selectedIds
        // Scale/rotate with a selection: pressing on some other item is ambiguous — a drag
        // transforms the selection, a tap selects that item instead (decided on release).
        let tapSelect: string | null = null
        if (hitId && !e.shiftKey && !sel.includes(hitId) && sel.length && tool !== 'move') {
          tapSelect = hitId
        } else if (hitId && (e.shiftKey || !sel.includes(hitId))) {
          sel = e.shiftKey ? (sel.includes(hitId) ? sel.filter((i) => i !== hitId) : [...sel, hitId]) : [hitId]
          props.onSelect(sel)
          // Scale/rotate: a tap picks what to transform. Move: tap-and-drag moves it right away.
          if (tool !== 'move' || e.shiftKey) return
        }
        if (!sel.length) {
          begin({ ...base, kind: 'marquee', origin: wp, base: [] })
          return
        }
        const snapshot = board.get()
        const ids = new Set(sel)
        if (tool === 'move') {
          begin({ ...base, kind: 'move', origin: wp, originScreen: sp, ids, snapshot, moved: false, clearOnTap: !hitId })
        } else {
          // Selection changed in this same event? Its bounds aren't rendered yet; compute them now.
          const m = toMap(snapshot)
          const bounds = unionRects(snapshot.filter((x) => ids.has(x.id)).map((x) => getBounds(x, m)))
          const p = sel === selectedIds && pivot ? pivot : bounds ? center(bounds) : wp
          begin({
            ...base,
            kind: 'transform',
            mode: tool,
            origin: wp,
            originScreen: sp,
            ids,
            snapshot,
            pivot: p,
            moved: false,
            clearOnTap: !hitId,
            tapSelect,
          })
        }
        return
      }
      case 'pen': {
        const el: PathElement = {
          id: newId(),
          type: 'path',
          points: [[wp.x, wp.y, pressureOf(e.nativeEvent)]],
          stroke: props.pen.color,
          size: props.pen.highlighter ? props.pen.size * 3 : props.pen.size,
          opacity: props.pen.highlighter ? 0.4 : 1,
          highlighter: props.pen.highlighter,
          simulatePressure: e.pointerType !== 'pen',
        }
        begin({ ...base, kind: 'draw', id: el.id })
        mutate((els) => [...els, el])
        if (selectedIds.length) props.onSelect([])
        return
      }
      case 'curve':
        begin({ ...base, kind: 'draw-curve', points: [wp] })
        setDraft([wp])
        if (selectedIds.length) props.onSelect([])
        return
      case 'text':
        createText(wp)
        return
      case 'shape': {
        const s = props.style
        const el: ShapeElement = {
          id: newId(),
          type: 'shape',
          kind: props.shapeKind,
          x: wp.x,
          y: wp.y,
          w: 0,
          h: 0,
          fill: s.fill,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          dash: s.dash,
          label: '',
          fontSize: s.fontSize,
        }
        begin({ ...base, kind: 'create-shape', id: el.id, origin: wp })
        mutate((els) => [...els, el])
        return
      }
      case 'line': {
        const s = props.style
        const lp = props.lineStyle
        const startShape = shapeAt(wp, board.get(), null, SNAP_PX / vpRef.current.zoom)
        const el: LineElement = {
          id: newId(),
          type: 'line',
          start: wp,
          end: wp,
          startBinding: startShape?.id ?? null,
          endBinding: null,
          startCap: lp.startCap,
          endCap: lp.endCap,
          routing: lp.routing,
          dash: lp.dash,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          label: '',
          fontSize: s.fontSize,
        }
        begin({ ...base, kind: 'create-line', id: el.id, origin: wp })
        mutate((els) => [...els, el])
        return
      }
    }

    // --- Select tool ---
    const handle = target.closest('[data-handle]')
    const tapKey = handle ? `${handle.getAttribute('data-handle')}:${handle.getAttribute('data-index')}` : hitId
    const now = performance.now()
    const lt = lastTap.current
    const isDouble =
      now - lt.time < DOUBLE_TAP_MS && Math.hypot(sp.x - lt.x, sp.y - lt.y) < 24 && lt.id === tapKey
    lastTap.current = { time: isDouble ? 0 : now, id: tapKey, x: sp.x, y: sp.y }
    if (isDouble) {
      const hitEl = hitId ? map.get(hitId) : undefined
      if (handle?.getAttribute('data-handle') === 'node' && handle.getAttribute('data-part') === 'anchor') {
        // Double-click a curve point: toggle smooth/corner.
        const id = handle.getAttribute('data-for')!
        const index = Number(handle.getAttribute('data-index'))
        board.change((els) =>
          els.map((el) => (el.id === id && el.type === 'curve' ? { ...el, points: toggleSmooth(el.points, el.closed, index) } : el)),
        )
      } else if (hitEl?.type === 'curve') {
        // Double-click a curve: add a point there without changing its shape.
        const { segment, t } = nearestOnCurve(hitEl.points, wp)
        const split = splitSegment(hitEl.points, hitEl.closed, segment, t)
        board.change((els) => els.map((el) => (el.id === hitEl.id ? { ...hitEl, points: split.points } : el)))
        props.onSelect([hitEl.id])
        props.onActiveNode({ id: hitEl.id, index: split.index })
      } else if (hitId && isLabelable(hitEl)) {
        props.onSelect([hitId])
        props.onEdit({ id: hitId })
      } else if (!hitId && !handle) {
        createText(wp)
      }
      return
    }

    if (handle) {
      const h = handle.getAttribute('data-handle')!
      const id = handle.getAttribute('data-for')!
      const el = map.get(id)
      if (el?.type === 'curve' && h === 'node') {
        const index = Number(handle.getAttribute('data-index'))
        const part = handle.getAttribute('data-part') as NodePart
        if (part === 'anchor') props.onActiveNode({ id, index })
        const node = toNodes(el.points, el.closed)[index]
        begin({ ...base, kind: 'node', id, index, part, original: el, mirror: part !== 'anchor' && isSmooth(node) })
      } else if (el?.type === 'line' && (h === 'start' || h === 'end')) {
        begin({ ...base, kind: 'line-end', id, end: h })
      } else if (el?.type === 'shape') {
        begin({ ...base, kind: 'resize', id, handle: h, original: el })
      }
      return
    }

    if (hitId) {
      let sel = selectedIds
      if (e.shiftKey) sel = sel.includes(hitId) ? sel.filter((i) => i !== hitId) : [...sel, hitId]
      else if (!sel.includes(hitId)) sel = [hitId]
      props.onSelect(sel)
      if (props.activeNode) props.onActiveNode(null)
      begin({
        ...base,
        kind: 'move',
        origin: wp,
        originScreen: sp,
        ids: new Set(sel),
        snapshot: board.get(),
        moved: false,
      })
    } else {
      const baseSel = e.shiftKey ? selectedIds : []
      if (!e.shiftKey && selectedIds.length) props.onSelect([])
      begin({ ...base, kind: 'marquee', origin: wp, base: baseSel })
    }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (props.onCursor && e.isPrimary) props.onCursor(toWorld(toScreen(e)))
    if (!pointers.current.has(e.pointerId)) return
    const sp = toScreen(e)
    pointers.current.set(e.pointerId, sp)
    const g = gesture.current
    if (!g) return

    if (g.kind === 'pinch') {
      const a = pointers.current.get(g.ids[0])
      const b = pointers.current.get(g.ids[1])
      if (!a || !b) return
      const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const v0 = g.startVp
      const zoom = clampZoom(v0.zoom * (dist / g.startDist))
      const wx = (g.startMid.x - v0.x) / v0.zoom
      const wy = (g.startMid.y - v0.y) / v0.zoom
      setViewport({ zoom, x: mid.x - wx * zoom, y: mid.y - wy * zoom })
      return
    }
    if (g.pointerId !== e.pointerId) return
    const wp = toWorld(sp)

    switch (g.kind) {
      case 'pan':
        setViewport({ ...g.startVp, x: g.startVp.x + sp.x - g.startScreen.x, y: g.startVp.y + sp.y - g.startScreen.y })
        break
      case 'draw': {
        const pts = coalesced(e.nativeEvent).map((ev) => {
          const w = toWorld(toScreen(ev))
          return [w.x, w.y, pressureOf(ev)]
        })
        updateEl<PathElement>(g.id, (el) => ({ ...el, points: [...el.points, ...pts] }))
        break
      }
      case 'draw-curve':
        for (const ev of coalesced(e.nativeEvent)) g.points.push(toWorld(toScreen(ev)))
        setDraft(g.points.slice())
        break
      case 'erase':
        eraseAlong(g.last, sp)
        g.last = sp
        break
      case 'create-shape': {
        const dx = wp.x - g.origin.x
        const dy = wp.y - g.origin.y
        let rect = normalizeRect(g.origin, wp)
        if (LOCKED_ASPECT.has(props.shapeKind) || e.shiftKey) {
          const s = Math.max(Math.abs(dx), Math.abs(dy))
          rect = { x: dx < 0 ? g.origin.x - s : g.origin.x, y: dy < 0 ? g.origin.y - s : g.origin.y, w: s, h: s }
        }
        updateEl<ShapeElement>(g.id, (el) => ({ ...el, ...rect }))
        break
      }
      case 'create-line': {
        const hit = shapeAt(wp, board.get(), g.id, SNAP_PX / vpRef.current.zoom)
        const line = board.get().find((x) => x.id === g.id)
        // Never attach both ends to the same shape (the line would have no length).
        const target = hit && line?.type === 'line' && hit.id === line.startBinding ? null : hit
        const end = e.shiftKey && !target ? snapAngle(g.origin, wp) : wp
        setBindTarget(target?.id ?? null)
        updateEl<LineElement>(g.id, (l) => ({ ...l, end, endBinding: target?.id ?? null }))
        break
      }
      case 'move': {
        if (!g.moved && Math.hypot(sp.x - g.originScreen.x, sp.y - g.originScreen.y) < 4) return
        g.moved = true
        const dx = wp.x - g.origin.x
        const dy = wp.y - g.origin.y
        mutate((els) => mergeFrom(els, translateElements(g.snapshot, g.ids, dx, dy), g.ids))
        break
      }
      case 'resize': {
        const lock = LOCKED_ASPECT.has(g.original.kind) || e.shiftKey
        const rect = resizeShape(g.original, g.handle, wp, lock)
        updateEl<ShapeElement>(g.id, (el) => ({ ...el, ...rect }))
        break
      }
      case 'pivot':
        setPivotState({ key: selectedIds.join(','), p: wp })
        break
      case 'transform': {
        if (!g.moved && Math.hypot(sp.x - g.originScreen.x, sp.y - g.originScreen.y) < 3) return
        g.moved = true
        const hudAt = { x: sp.x + 18, y: sp.y + 18 }
        if (g.mode === 'rotate') {
          const a0 = Math.atan2(g.origin.y - g.pivot.y, g.origin.x - g.pivot.x)
          const a1 = Math.atan2(wp.y - g.pivot.y, wp.x - g.pivot.x)
          let angle = a1 - a0
          if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12)
          let deg = Math.round((angle * 180) / Math.PI)
          if (deg > 180) deg -= 360
          if (deg <= -180) deg += 360
          setHud({ ...hudAt, text: `${deg}°` })
          mutate((els) => mergeFrom(els, rotateElements(g.snapshot, g.ids, g.pivot, angle), g.ids))
        } else if (g.mode === 'scale') {
          const zoom = vpRef.current.zoom
          const dx0 = g.origin.x - g.pivot.x
          const dy0 = g.origin.y - g.pivot.y
          const d0 = Math.hypot(dx0, dy0)
          if (d0 < 2 / zoom) return
          let sx: number
          let sy: number
          if (e.shiftKey) {
            // Free scaling: each axis follows the pointer independently.
            const min = 8 / zoom
            sx = Math.abs(dx0) > min ? (wp.x - g.pivot.x) / dx0 : 1
            sy = Math.abs(dy0) > min ? (wp.y - g.pivot.y) / dy0 : 1
          } else {
            sx = sy = Math.max(0.01, Math.hypot(wp.x - g.pivot.x, wp.y - g.pivot.y) / d0)
          }
          setHud({
            ...hudAt,
            text: sx === sy ? `${Math.round(sx * 100)}%` : `${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%`,
          })
          mutate((els) => mergeFrom(els, scaleElements(g.snapshot, g.ids, g.pivot, sx, sy), g.ids))
        } else if (g.box && g.handle) {
          const { sx, sy, anchor } = handleScale(g.box, g.handle, wp, e.shiftKey)
          setHud({
            ...hudAt,
            text: sx === sy ? `${Math.round(sx * 100)}%` : `${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%`,
          })
          mutate((els) => mergeFrom(els, scaleElements(g.snapshot, g.ids, anchor, sx, sy), g.ids))
        }
        break
      }
      case 'node': {
        // Alt/Option breaks handle symmetry while dragging.
        const points = moveNodePart(g.original.points, g.original.closed, g.index, g.part, wp, g.mirror && !e.altKey)
        updateEl<CurveElement>(g.id, (el) => ({ ...el, points }))
        break
      }
      case 'line-end': {
        // Dropping an end on or near a shape attaches it; dragging it clear detaches it.
        const target = shapeAt(wp, board.get(), g.id, SNAP_PX / vpRef.current.zoom)
        setBindTarget(target?.id ?? null)
        const binding = target?.id ?? null
        updateEl<LineElement>(g.id, (l) =>
          g.end === 'start' ? { ...l, start: wp, startBinding: binding } : { ...l, end: wp, endBinding: binding },
        )
        break
      }
      case 'marquee': {
        const rect = normalizeRect(g.origin, wp)
        setMarquee(rect)
        const els = board.get()
        const m = toMap(els)
        const hits = els.filter((el) => rectsIntersect(rect, getBounds(el, m))).map((el) => el.id)
        props.onSelect([...new Set([...g.base, ...hits])])
        break
      }
    }
  }

  const finishGesture = (g: Gesture) => {
    switch (g.kind) {
      case 'move':
        if (!g.moved && g.clearOnTap) props.onSelect([])
        break
      case 'transform':
        if (!g.moved && g.tapSelect) props.onSelect([g.tapSelect])
        else if (!g.moved && g.clearOnTap) props.onSelect([])
        // Keep rotating/scaling about the same point next time, even though the bounds moved.
        else if (g.moved && g.mode !== 'box') setPivotState({ key: [...g.ids].join(','), p: g.pivot })
        break
      case 'draw-curve': {
        const fitted = strokeToCurve(g.points, vpRef.current.zoom)
        if (fitted) {
          const el: CurveElement = {
            id: newId(),
            type: 'curve',
            ...fitted,
            stroke: props.pen.color,
            strokeWidth: props.pen.size,
            dash: 'solid',
            fill: 'none',
          }
          board.change((els) => [...els, el])
        }
        break
      }
      case 'create-shape': {
        const el = board.get().find((x) => x.id === g.id)
        if (el?.type === 'shape' && el.w < 6 && el.h < 6) {
          // A tap places a default-sized shape, handy on touch screens.
          const locked = LOCKED_ASPECT.has(el.kind)
          const w = locked ? 100 : 140
          const h = locked ? 100 : 90
          updateEl<ShapeElement>(g.id, (s) => ({ ...s, x: g.origin.x - w / 2, y: g.origin.y - h / 2, w, h }))
        }
        props.onSelect([g.id])
        props.onTool('select')
        break
      }
      case 'create-line': {
        const el = board.get().find((x) => x.id === g.id)
        if (el?.type === 'line') {
          const pts = linePoints(el, toMap(board.get()))
          const a = pts[0]
          const b = pts[pts.length - 1]
          if (Math.hypot(b.x - a.x, b.y - a.y) < 6 && !el.endBinding) {
            updateEl<LineElement>(g.id, (l) => ({ ...l, end: { x: l.start.x + 160, y: l.start.y } }))
          }
        }
        props.onSelect([g.id])
        props.onTool('select')
        break
      }
      default:
        break
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (!g.ids.includes(e.pointerId)) return
      gesture.current = null
    } else {
      if (g.pointerId !== e.pointerId) return
      finishGesture(g)
      gesture.current = null
    }
    setBusy(false)
    setMarquee(null)
    setBindTarget(null)
    setDraft(null)
    setHud(null)
  }

  // ----- Rendering -----

  const selected = elements.filter((el) => selectedSet.has(el.id))
  const selectionBounds = unionRects(selected.map((el) => getBounds(el, map)))
  const zoom = viewport.zoom
  const handleSize = 10 / zoom
  const hitRadius = 14 / zoom
  const selKey = selectedIds.join(',')
  const pivot =
    pivotState?.key === selKey ? pivotState.p : selectionBounds ? center(selectionBounds) : null
  const transformTool = tool === 'move' || tool === 'scale' || tool === 'rotate'

  // The active curve point only counts while its curve is the sole selection.
  const soleCurve = selected.length === 1 && selected[0].type === 'curve' ? selected[0] : null
  const soleCurveNodes = soleCurve ? toNodes(soleCurve.points, soleCurve.closed) : []
  const activeIndex =
    soleCurve && props.activeNode?.id === soleCurve.id && props.activeNode.index < soleCurveNodes.length
      ? props.activeNode.index
      : null
  const nodeActions =
    soleCurve && activeIndex !== null
      ? {
          smooth: isSmooth(soleCurveNodes[activeIndex]),
          onToggleSmooth: () =>
            board.change((els) =>
              els.map((el) =>
                el.id === soleCurve.id && el.type === 'curve'
                  ? { ...el, points: toggleSmooth(el.points, el.closed, activeIndex) }
                  : el,
              ),
            ),
          onDelete: () => {
            board.change((els) => deleteNodeFromBoard(els, soleCurve.id, activeIndex))
            props.onActiveNode(null)
          },
        }
      : undefined

  // Keep the floating menu clear of curve handles, which can reach outside the curve itself.
  const menuBounds =
    soleCurve && selectionBounds
      ? unionRects([selectionBounds, ...soleCurve.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))])!
      : selectionBounds

  const renderHandles = () => {
    if (selected.length !== 1 || editing) return null
    const el = selected[0]
    // Select tool edits everything; the scale tool reuses the shape's own resize handles.
    if (tool !== 'select' && !(tool === 'scale' && el.type === 'shape')) return null
    if (el.type === 'shape') {
      const local: Record<string, Point> = {
        nw: { x: el.x, y: el.y },
        n: { x: el.x + el.w / 2, y: el.y },
        ne: { x: el.x + el.w, y: el.y },
        e: { x: el.x + el.w, y: el.y + el.h / 2 },
        se: { x: el.x + el.w, y: el.y + el.h },
        s: { x: el.x + el.w / 2, y: el.y + el.h },
        sw: { x: el.x, y: el.y + el.h },
        w: { x: el.x, y: el.y + el.h / 2 },
      }
      const pos = Object.fromEntries(Object.entries(local).map(([k, p]) => [k, fromLocal(el, p)]))
      return HANDLES.map((h) => (
        <g key={h} data-handle={h} data-for={el.id} style={{ cursor: handleCursor(h, el.rotation ?? 0) }}>
          <circle cx={pos[h].x} cy={pos[h].y} r={hitRadius} fill="transparent" />
          <rect
            x={pos[h].x - handleSize / 2}
            y={pos[h].y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            rx={2 / zoom}
            className="handle"
            strokeWidth={1.5 / zoom}
            transform={el.rotation ? `rotate(${(el.rotation * 180) / Math.PI} ${pos[h].x} ${pos[h].y})` : undefined}
          />
        </g>
      ))
    }
    if (el.type === 'curve') {
      const nodes = toNodes(el.points, el.closed)
      const last = nodes.length - 1
      const handleProps = (index: number, part: NodePart) => ({
        'data-handle': 'node',
        'data-for': el.id,
        'data-index': index,
        'data-part': part,
      })
      // Handles shown: the active point's own, plus its neighbors' facing handles.
      const shown: { index: number; part: 'in' | 'out' }[] = []
      if (activeIndex !== null) {
        const hasIn = (i: number) => el.closed || i > 0
        const hasOut = (i: number) => el.closed || i < last
        if (hasIn(activeIndex)) shown.push({ index: activeIndex, part: 'in' })
        if (hasOut(activeIndex)) shown.push({ index: activeIndex, part: 'out' })
        const prev = (activeIndex - 1 + nodes.length) % nodes.length
        const next = (activeIndex + 1) % nodes.length
        if (hasIn(activeIndex) && prev !== activeIndex) shown.push({ index: prev, part: 'out' })
        if (hasOut(activeIndex) && next !== activeIndex && next !== prev) shown.push({ index: next, part: 'in' })
      }
      return (
        <>
          {shown.map(({ index, part }) => {
            const n = nodes[index]
            const h = n[part]
            return (
              <g key={`${index}-${part}`} {...handleProps(index, part)} style={{ cursor: 'move' }}>
                <line x1={n.p.x} y1={n.p.y} x2={h.x} y2={h.y} className="handle-arm" strokeWidth={1 / zoom} />
                <circle cx={h.x} cy={h.y} r={hitRadius} fill="transparent" />
                <circle cx={h.x} cy={h.y} r={handleSize / 2.2} className="handle control" strokeWidth={1.5 / zoom} />
              </g>
            )
          })}
          {nodes.map((n, index) => {
            const active = index === activeIndex
            const cls = `handle anchor${active ? ' active' : ''}`
            const s = handleSize * (active ? 1.15 : 0.9)
            return (
              <g key={index} {...handleProps(index, 'anchor')} style={{ cursor: 'move' }}>
                <circle cx={n.p.x} cy={n.p.y} r={hitRadius} fill="transparent" />
                {isSmooth(n) ? (
                  <circle cx={n.p.x} cy={n.p.y} r={s / 2} className={cls} strokeWidth={1.5 / zoom} />
                ) : (
                  <rect x={n.p.x - s / 2} y={n.p.y - s / 2} width={s} height={s} className={cls} strokeWidth={1.5 / zoom} />
                )}
              </g>
            )
          })}
        </>
      )
    }
    if (el.type === 'line') {
      const pts = linePoints(el, map)
      const ends = { start: pts[0], end: pts[pts.length - 1] }
      return (['start', 'end'] as const).map((h) => (
        <g key={h} data-handle={h} data-for={el.id} style={{ cursor: 'move' }}>
          <circle cx={ends[h].x} cy={ends[h].y} r={hitRadius} fill="transparent" />
          <circle cx={ends[h].x} cy={ends[h].y} r={handleSize / 1.6} className="handle" strokeWidth={1.5 / zoom} />
        </g>
      ))
    }
    return null
  }

  const bindEl = bindTarget ? map.get(bindTarget) : undefined
  const editingEl = editing ? map.get(editing.id) : undefined

  const cursor =
    tool === 'hand' || props.spaceHeld
      ? busy
        ? 'grabbing'
        : 'grab'
      : tool === 'select'
        ? 'default'
        : tool === 'move'
          ? 'move'
          : tool === 'text'
          ? 'text'
          : 'crosshair'

  function renderSelectionOutline() {
    if (!selectionBounds) return null
    const single = selected.length === 1 ? selected[0] : null
    // Lines and curves show their own points in the select tool instead of a box.
    if (single && (single.type === 'line' || single.type === 'curve') && !transformTool) return null
    const dash = `${4 / zoom} ${3 / zoom}`
    if (single?.type === 'shape' && single.rotation) {
      return (
        <polygon
          points={shapeCorners(single)
            .map((p) => `${p.x},${p.y}`)
            .join(' ')}
          className="selection-box"
          strokeWidth={1 / zoom}
          strokeDasharray={dash}
          pointerEvents="none"
        />
      )
    }
    return (
      <rect
        x={selectionBounds.x - 4 / zoom}
        y={selectionBounds.y - 4 / zoom}
        width={selectionBounds.w + 8 / zoom}
        height={selectionBounds.h + 8 / zoom}
        className="selection-box"
        strokeWidth={1 / zoom}
        strokeDasharray={dash}
        pointerEvents="none"
      />
    )
  }

  /** Scale tool: handles on the selection's box (a lone shape uses its own resize handles instead). */
  function renderBoxHandles() {
    if (!selectionBounds || selected.length === 0) return null
    if (selected.length === 1 && selected[0].type === 'shape') return null
    const b = selectionBounds
    const pos: Record<string, Point> = {
      nw: { x: b.x, y: b.y },
      n: { x: b.x + b.w / 2, y: b.y },
      ne: { x: b.x + b.w, y: b.y },
      e: { x: b.x + b.w, y: b.y + b.h / 2 },
      se: { x: b.x + b.w, y: b.y + b.h },
      s: { x: b.x + b.w / 2, y: b.y + b.h },
      sw: { x: b.x, y: b.y + b.h },
      w: { x: b.x, y: b.y + b.h / 2 },
    }
    // Skip edge handles on a flat box (e.g. a horizontal line) — they'd sit on the corners.
    const flatX = b.w * zoom < 16
    const flatY = b.h * zoom < 16
    return HANDLES.filter((h) => !(flatX && /[we]/.test(h) && h.length === 1) && !(flatY && /[ns]/.test(h) && h.length === 1)).map(
      (h) => (
        <g key={h} data-handle="box" data-pos={h} style={{ cursor: handleCursor(h, 0) }}>
          <circle cx={pos[h].x} cy={pos[h].y} r={hitRadius} fill="transparent" />
          <rect
            x={pos[h].x - handleSize / 2}
            y={pos[h].y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            rx={2 / zoom}
            className="handle"
            strokeWidth={1.5 / zoom}
          />
        </g>
      ),
    )
  }

  /** Other people's selections (outlined in their color) and cursors (with a name tag). */
  function renderPeers() {
    return props.peers.map((peer) => {
      const bounds = unionRects(
        peer.selection.flatMap((id) => {
          const el = map.get(id)
          return el ? [getBounds(el, map)] : []
        }),
      )
      const c = peer.cursor
      const s = 1 / zoom
      return (
        <g key={peer.clientId} pointerEvents="none">
          {bounds && (
            <rect
              x={bounds.x - 6 * s}
              y={bounds.y - 6 * s}
              width={bounds.w + 12 * s}
              height={bounds.h + 12 * s}
              rx={4 * s}
              fill="none"
              stroke={peer.color}
              strokeWidth={2 * s}
              strokeDasharray={`${6 * s} ${4 * s}`}
            />
          )}
          {c && (
            // Drawn at screen size regardless of zoom.
            <g transform={`translate(${c.x} ${c.y}) scale(${s})`} className="peer-cursor">
              <path d="M0 0 L0 17 L4.5 13 L7.5 20 L10.5 18.7 L7.6 12 L13 12 Z" fill={peer.color} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
              <foreignObject x={12} y={16} width={220} height={28} style={{ overflow: 'visible' }}>
                <span className="peer-name" style={{ background: peer.color }}>
                  {peer.name}
                </span>
              </foreignObject>
            </g>
          )}
        </g>
      )
    })
  }

  const gridSize = 24 * zoom
  const showMenu =
    !busy && !editing && selected.length > 0 && selectionBounds && (tool === 'select' || transformTool)

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <svg
        ref={svgRef}
        className="board"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => props.onCursor?.(null)}
        onMouseDown={preventFocusSteal}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width={gridSize} height={gridSize} x={viewport.x} y={viewport.y} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} className="grid-dot" />
          </pattern>
        </defs>
        {zoom > 0.35 && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${zoom})`}>
          <g data-layer="content">
            {elements.map((el) => {
              const hideLabel = editing?.id === el.id
              switch (el.type) {
                case 'shape':
                  return <ShapeView key={el.id} el={el} hideLabel={hideLabel} />
                case 'line':
                  return <LineView key={el.id} el={el} points={linePoints(el, map)} hideLabel={hideLabel} />
                case 'path':
                  return <PathView key={el.id} el={el} />
                case 'curve':
                  return <CurveView key={el.id} el={el} />
              }
            })}
          </g>
          <g data-layer="overlay">
            {draft && (
              <polyline
                points={draft.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={paint.ink(props.pen.color)}
                strokeWidth={props.pen.size}
                strokeOpacity={0.55}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}
            {bindEl?.type === 'shape' && (
              <rect
                x={bindEl.x - 4 / zoom}
                y={bindEl.y - 4 / zoom}
                width={bindEl.w + 8 / zoom}
                height={bindEl.h + 8 / zoom}
                rx={6 / zoom}
                className="bind-target"
                strokeWidth={2 / zoom}
                pointerEvents="none"
                transform={
                  bindEl.rotation
                    ? `rotate(${(bindEl.rotation * 180) / Math.PI} ${bindEl.x + bindEl.w / 2} ${bindEl.y + bindEl.h / 2})`
                    : undefined
                }
              />
            )}
            {renderSelectionOutline()}
            {renderHandles()}
            {tool === 'scale' && !busy && renderBoxHandles()}
            {(tool === 'scale' || tool === 'rotate') && pivot && selected.length > 0 && (
              <g data-handle="pivot" style={{ cursor: 'move' }}>
                <circle cx={pivot.x} cy={pivot.y} r={hitRadius} fill="transparent" />
                <circle cx={pivot.x} cy={pivot.y} r={6 / zoom} className="pivot" strokeWidth={1.5 / zoom} />
                <path
                  d={`M${pivot.x - 10 / zoom} ${pivot.y}H${pivot.x + 10 / zoom}M${pivot.x} ${pivot.y - 10 / zoom}V${pivot.y + 10 / zoom}`}
                  className="pivot-cross"
                  strokeWidth={1.5 / zoom}
                />
              </g>
            )}
            {renderPeers()}
            {marquee && (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                className="marquee"
                strokeWidth={1 / zoom}
                pointerEvents="none"
              />
            )}
          </g>
        </g>
      </svg>

      {showMenu && (
        <ContextMenu
          key={selectedIds.join(',')}
          selected={selected}
          anchor={{
            x: menuBounds!.x * zoom + viewport.x,
            y: menuBounds!.y * zoom + viewport.y,
            w: menuBounds!.w * zoom,
            h: menuBounds!.h * zoom,
          }}
          container={size}
          onPatch={props.actions.patch}
          onEditLabel={() => props.onEdit({ id: selected[0].id })}
          onDuplicate={props.actions.duplicate}
          onDelete={props.actions.remove}
          onFront={props.actions.front}
          onBack={props.actions.back}
          onRotate90={props.actions.rotate90}
          onFlip={props.actions.flip}
          nodeActions={nodeActions}
        />
      )}

      {hud && (
        <div className="transform-hud" style={{ left: hud.x, top: hud.y }}>
          {hud.text}
        </div>
      )}

      {editing && editingEl && (editingEl.type === 'shape' || editingEl.type === 'line') && (
        <LabelEditor
          key={editing.id}
          element={editingEl}
          map={map}
          viewport={viewport}
          initialText={editing.initialText}
          onCommit={(text) => {
            const trimmed = text.replace(/\s+$/, '')
            if (editingEl.type === 'shape' && editingEl.kind === 'text') {
              if (!trimmed.trim()) {
                // Empty free-standing text disappears.
                board.update((els) => removeElements(els, new Set([editing.id])))
                props.onSelect([])
              } else if (trimmed !== editingEl.label) {
                const { w, h } = measureText(trimmed, editingEl.fontSize)
                board.change((els) =>
                  els.map((el) => (el.id === editing.id ? { ...el, label: trimmed, w, h } : el)),
                )
              }
            } else if (trimmed !== editingEl.label) {
              board.change((els) => els.map((el) => (el.id === editing.id ? { ...el, label: trimmed } : el)))
            }
            props.onEdit(null)
          }}
          onCancel={() => {
            if (editingEl.type === 'shape' && editingEl.kind === 'text' && !editingEl.label) {
              board.update((els) => removeElements(els, new Set([editing.id])))
              props.onSelect([])
            }
            props.onEdit(null)
          }}
        />
      )}
    </div>
  )
}
