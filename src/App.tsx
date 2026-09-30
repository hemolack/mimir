import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from './components/Canvas'
import type { ActiveNode, Editing, SelectionActions } from './components/Canvas'
import { deleteNodeFromBoard, nodeCount } from './curveEdit'
import { Palette } from './components/Palette'
import { TopBar } from './components/TopBar'
import { LINE_PRESETS, MAX_ZOOM, MIN_ZOOM, SHAPES } from './constants'
import { contentBounds, exportPng, exportSvg, pickFile, saveBoardFile } from './exporters'
import {
  bakeLines,
  bringToFront,
  cloneElements,
  isLabelable,
  removeElements,
  sendToBack,
  translateElements,
} from './ops'
import { loadBoard, loadSettings, parseBoardFile, saveBoard, saveSettings } from './storage'
import { rotateElements, scaleElements } from './transform'
import type { BoardElement, PenSettings, ShapeKind, Tool, Viewport } from './types'
import { useBoard } from './useBoard'

const HINTS: Record<Tool, string> = {
  select: 'Double-click empty space to add text · select a shape and start typing to label it',
  hand: 'Drag to pan · pinch or Ctrl+scroll to zoom',
  move: 'Drag anywhere to move the selection · tap an item to pick it · arrow keys nudge',
  scale: 'Drag anywhere to scale about the pivot (Shift: per axis) · drag box handles to stretch or flip · drag the ⊕ to move the pivot',
  rotate: 'Drag anywhere to rotate about the pivot · Shift snaps to 15° · drag the ⊕ to move the pivot',
  pen: 'Draw with a mouse, finger or stylus · pinch with two fingers to zoom',
  curve: 'Draw freely — the stroke becomes smooth Bézier curves when you lift · end where you started to close it',
  eraser: 'Drag across anything to erase it',
  text: 'Click where the text should go',
  shape: 'Drag to draw, or tap to drop one · hold Shift to keep proportions',
  line: 'Drag between shapes to connect them · hold Shift to snap angles',
}

/** Tools that operate on the current selection rather than drawing something new. */
const KEEPS_SELECTION: Tool[] = ['select', 'hand', 'move', 'scale', 'rotate']

const CURVE_EDIT_HINT =
  'Drag points and handles to reshape · double-click the curve to add a point · double-click a point for smooth/corner · Alt-drag a handle to break symmetry'

export default function App() {
  const [saved] = useState(loadBoard)
  const [settings] = useState(loadSettings)
  const board = useBoard(() => saved.elements)
  const [viewport, setViewport] = useState<Viewport>(saved.viewport)
  const [tool, setToolState] = useState<Tool>('select')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rectangle')
  const [linePreset, setLinePreset] = useState(1)
  const [pen, setPen] = useState(settings.pen)
  const [style, setStyle] = useState(settings.style)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [activeNode, setActiveNode] = useState<ActiveNode | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const clipboard = useRef<BoardElement[]>([])
  const svgRef = useRef<SVGSVGElement>(null)

  const elements = board.elements
  // Undo/redo can remove selected elements; ignore ids that no longer exist.
  const selection = useMemo(() => {
    const ids = new Set(elements.map((el) => el.id))
    return selectedIds.filter((id) => ids.has(id))
  }, [elements, selectedIds])
  const selSet = new Set(selection)
  const soleCurve = (() => {
    if (selection.length !== 1) return null
    const el = elements.find((e) => e.id === selection[0])
    return el?.type === 'curve' ? el : null
  })()
  // Only meaningful while its curve is the sole selection and the point still exists.
  const liveNode =
    soleCurve && activeNode?.id === soleCurve.id && activeNode.index < nodeCount(soleCurve) ? activeNode : null

  // ----- Persistence -----
  const latest = useRef({ elements, viewport })
  latest.current = { elements, viewport }

  useEffect(() => {
    const t = setTimeout(() => {
      if (!saveBoard({ elements, viewport })) showToast('Could not save — browser storage is full or disabled')
    }, 300)
    return () => clearTimeout(t)
  }, [elements, viewport])

  useEffect(() => {
    const flush = () => saveBoard(latest.current)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  useEffect(() => saveSettings({ pen, style }), [pen, style])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  function showToast(message: string) {
    setToast(message)
  }

  // ----- Actions -----
  const setTool = (t: Tool) => {
    setToolState(t)
    // Navigation and transform tools work on the current selection; drawing tools start fresh.
    if (!KEEPS_SELECTION.includes(t)) setSelectedIds([])
  }

  const chosen = () => board.get().filter((el) => selSet.has(el.id))

  const actions: SelectionActions = {
    patch(fn, stylePatch) {
      board.change((els) => els.map((el) => (selSet.has(el.id) ? fn(el) : el)))
      if (stylePatch) setStyle((s) => ({ ...s, ...stylePatch }))
    },
    duplicate() {
      if (!selSet.size) return
      const copies = cloneElements(bakeLines(chosen(), board.get()), 20)
      board.change((els) => [...els, ...copies])
      setSelectedIds(copies.map((el) => el.id))
    },
    remove() {
      if (!selSet.size) return
      board.change((els) => removeElements(els, selSet))
      setSelectedIds([])
    },
    front() {
      board.change((els) => bringToFront(els, selSet))
    },
    back() {
      board.change((els) => sendToBack(els, selSet))
    },
    rotate90() {
      const c = selectionCenter()
      if (c) board.change((els) => rotateElements(els, selSet, c, Math.PI / 2))
    },
    flip(axis) {
      const c = selectionCenter()
      if (c) board.change((els) => scaleElements(els, selSet, c, axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1))
    },
  }

  function selectionCenter() {
    const b = contentBounds(chosen())
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null
  }

  const copy = () => {
    if (selSet.size) clipboard.current = bakeLines(chosen(), board.get())
  }
  const paste = () => {
    if (!clipboard.current.length) return
    const copies = cloneElements(clipboard.current, 20)
    clipboard.current = copies
    board.change((els) => [...els, ...copies])
    if (!KEEPS_SELECTION.includes(tool)) setToolState('select')
    setSelectedIds(copies.map((el) => el.id))
  }

  const canvasSize = () => {
    const svg = svgRef.current
    return { w: svg?.clientWidth ?? window.innerWidth, h: svg?.clientHeight ?? window.innerHeight }
  }

  const zoomBy = (factor: number) => {
    const { w, h } = canvasSize()
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor))
    const cx = (w / 2 - viewport.x) / viewport.zoom
    const cy = (h / 2 - viewport.y) / viewport.zoom
    setViewport({ zoom, x: w / 2 - cx * zoom, y: h / 2 - cy * zoom })
  }

  const zoomFit = (els = board.get()) => {
    const b = contentBounds(els)
    if (!b) {
      setViewport({ x: 0, y: 0, zoom: 1 })
      return
    }
    const { w, h } = canvasSize()
    const zoom = Math.min(Math.max(Math.min((w - 160) / b.w, (h - 160) / b.h), MIN_ZOOM), 2)
    setViewport({ zoom, x: w / 2 - (b.x + b.w / 2) * zoom, y: h / 2 - (b.y + b.h / 2) * zoom })
  }

  const openFile = async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    const els = parseBoardFile(await file.text())
    if (!els) {
      showToast("That file isn't a whiteboard file")
      return
    }
    board.change(() => els)
    setSelectedIds([])
    zoomFit(els)
  }

  // ----- Keyboard -----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (editing) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key

      if (key === ' ') {
        e.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (mod) {
        const k = key.toLowerCase()
        const fn: Record<string, () => void> = {
          z: () => (e.shiftKey ? board.redo() : board.undo()),
          y: board.redo,
          d: actions.duplicate,
          a: () => {
            if (!KEEPS_SELECTION.includes(tool)) setToolState('select')
            setSelectedIds(board.get().map((el) => el.id))
          },
          c: copy,
          x: () => {
            copy()
            actions.remove()
          },
          v: paste,
          '=': () => zoomBy(1.2),
          '+': () => zoomBy(1.2),
          '-': () => zoomBy(1 / 1.2),
          '0': () => setViewport((v) => ({ ...v, zoom: 1 })),
        }
        if (fn[k]) {
          e.preventDefault()
          fn[k]()
        }
        return
      }
      if (e.altKey) return

      const single = selection.length === 1 ? board.get().find((el) => el.id === selection[0]) : undefined
      if (key === 'Delete' || key === 'Backspace') {
        if (liveNode) {
          e.preventDefault()
          board.change((els) => deleteNodeFromBoard(els, liveNode.id, liveNode.index))
          setActiveNode(null)
        } else if (selection.length) {
          e.preventDefault()
          actions.remove()
        }
        return
      }
      if (key === 'Escape') {
        if (liveNode) {
          setActiveNode(null)
          return
        }
        setSelectedIds([])
        setToolState('select')
        return
      }
      if (key === 'Enter' && single && isLabelable(single)) {
        e.preventDefault()
        setEditing({ id: single.id })
        return
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      if (arrows[key]) {
        if (!selection.length) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        board.change((els) => translateElements(els, selSet, arrows[key][0] * step, arrows[key][1] * step))
        return
      }
      // Typing while a single shape or line is selected starts editing its label.
      if (key.length === 1 && single && isLabelable(single) && tool === 'select') {
        e.preventDefault()
        setEditing({ id: single.id, initialText: key })
        return
      }
      const k = key.toLowerCase()
      if (e.shiftKey && k === 'r') {
        setTool('rotate')
        return
      }
      const shape = SHAPES.find((s) => s.key === k)
      if (shape) {
        setShapeKind(shape.kind)
        setTool('shape')
        return
      }
      const tools: Record<string, () => void> = {
        v: () => setTool('select'),
        h: () => setTool('hand'),
        m: () => setTool('move'),
        s: () => setTool('scale'),
        p: () => setTool('pen'),
        b: () => setTool('curve'),
        e: () => setTool('eraser'),
        t: () => setTool('text'),
        l: () => {
          setLinePreset(0)
          setTool('line')
        },
        a: () => {
          setLinePreset(1)
          setTool('line')
        },
      }
      tools[k]?.()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false)
    }
    const onBlur = () => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  })

  return (
    <div className="app">
      <Canvas
        board={board}
        viewport={viewport}
        onViewport={setViewport}
        tool={tool}
        onTool={setTool}
        shapeKind={shapeKind}
        linePreset={LINE_PRESETS[linePreset]}
        pen={pen}
        style={style}
        selectedIds={selection}
        onSelect={setSelectedIds}
        editing={editing}
        onEdit={setEditing}
        activeNode={activeNode}
        onActiveNode={setActiveNode}
        spaceHeld={spaceHeld}
        actions={actions}
        svgRef={svgRef}
      />
      <Palette
        tool={tool}
        shapeKind={shapeKind}
        linePreset={linePreset}
        pen={pen}
        onTool={setTool}
        onShape={(kind) => {
          setShapeKind(kind)
          setTool('shape')
        }}
        onLinePreset={(i) => {
          setLinePreset(i)
          setTool('line')
        }}
        onPen={(patch: Partial<PenSettings>) => setPen((p) => ({ ...p, ...patch }))}
      />
      <TopBar
        zoom={viewport.zoom}
        canUndo={board.canUndo}
        canRedo={board.canRedo}
        onUndo={board.undo}
        onRedo={board.redo}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onZoomReset={() => zoomBy(1 / viewport.zoom)}
        onZoomFit={() => zoomFit()}
        onExportSvg={() => {
          if (!svgRef.current || !exportSvg(svgRef.current, board.get())) showToast('Nothing to export yet')
        }}
        onExportPng={async () => {
          try {
            if (!svgRef.current || !(await exportPng(svgRef.current, board.get()))) showToast('Nothing to export yet')
          } catch {
            showToast('This browser blocked PNG export — try SVG instead')
          }
        }}
        onSave={() => saveBoardFile(board.get())}
        onOpen={openFile}
        onClear={() => {
          if (board.get().length && window.confirm('Clear the whole board? You can undo this.')) {
            board.change(() => [])
            setSelectedIds([])
          }
        }}
      />
      <div className="hint" aria-live="polite">
        {tool === 'select' && soleCurve ? CURVE_EDIT_HINT : HINTS[tool]}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
