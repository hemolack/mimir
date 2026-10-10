import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Canvas } from './components/Canvas'
import type { ActiveNode, Editing, SelectionActions } from './components/Canvas'
import { deleteNodeFromBoard, nodeCount } from './curveEdit'
import { Palette } from './components/Palette'
import { TopBar } from './components/TopBar'
import { MAX_ZOOM, MIN_ZOOM, SHAPES } from './constants'
import { ConfirmDialog, TextDialog } from './components/Dialogs'
import { ExportDialog } from './components/ExportDialog'
import type { ExportChoice } from './components/ExportDialog'
import { contentBounds, deliverExport, pickFile, pngSize, prepareExport, saveBoardFile } from './exporters'
import type { PreparedExport } from './exporters'
import { CANVAS, paintFor, ThemeContext, useSystemDark } from './theme'
import { lineToolOptions, selectionOptions } from './components/optionItems'
import type { OptionPanel } from './components/optionItems'
import type { Theme, ThemeSetting } from './theme'
import {
  bakeLines,
  bringToFront,
  cloneElements,
  isLabelable,
  newId,
  removeElements,
  sendToBack,
  translateElements,
} from './ops'
import { loadAccessKey, saveAccessKey, takeAccessKey } from './accessKey'
import { isEmbedded } from './embed'
import { boardIdFromPath, loadIdentity, newBoardId, saveIdentity, stashSeed, takeSeed } from './identity'
import type { PeerPresence } from './protocol'
import { loadBoard, loadSettings, parseBoardFile, sanitizeElements, saveBoard, saveSettings } from './storage'
import { SyncClient } from './sync'
import type { SyncStatus } from './sync'
import { rotateElements, scaleElements } from './transform'
import type { BoardElement, LineStyle, PenSettings, Point, ShapeKind, Tool, Viewport } from './types'
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
  // /board/<id> is a shared, live board; anything else is the private board kept in this browser.
  const [boardId] = useState(() => boardIdFromPath(location.pathname))
  // Read from this page's own URL each load, so it holds whatever URL the frame is pointed at.
  const [embedded] = useState(() => isEmbedded())
  // Once per page load (not per effect run), since it strips ?key= from the URL.
  const [initialKey] = useState(takeAccessKey)
  const [saved] = useState(() => (boardId ? { elements: [], viewport: { x: 0, y: 0, zoom: 1 } } : loadBoard()))
  const [settings] = useState(loadSettings)
  const sync = useRef<SyncClient | null>(null)
  const board = useBoard(
    () => saved.elements,
    (patch) => sync.current?.local(patch),
  )
  const [viewport, setViewport] = useState<Viewport>(saved.viewport)
  const [me, setMe] = useState(loadIdentity)
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [peers, setPeers] = useState<PeerPresence[]>([])
  const cursor = useRef<Point | null>(null)
  const [tool, setToolState] = useState<Tool>('select')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rectangle')
  const [lineStyle, setLineStyle] = useState<LineStyle>(settings.line)
  // ----- Theme -----
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(settings.theme)
  const systemDark = useSystemDark()
  const theme: Theme = themeSetting === 'system' ? (systemDark ? 'dark' : 'light') : themeSetting
  /** Temporarily overrides the rendered theme while an export snapshots the board. */
  const [renderTheme, setRenderTheme] = useState<Theme | null>(null)
  const [pen, setPen] = useState(settings.pen)
  const [style, setStyle] = useState(settings.style)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [activeNode, setActiveNode] = useState<ActiveNode | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** Which in-app dialog is open (the browser's prompt/confirm aren't reliable everywhere). */
  const [dialog, setDialog] = useState<'rename' | 'link' | 'clear' | 'deleted' | 'key' | null>(null)
  // Set when the server refused the key we sent (an empty key just means we never had one).
  const [keyRejected, setKeyRejected] = useState(false)
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

  // ----- Persistence (private board only; shared boards live on the server) -----
  const latest = useRef({ elements, viewport })
  latest.current = { elements, viewport }

  useEffect(() => {
    if (boardId) return
    const t = setTimeout(() => {
      if (!saveBoard({ elements, viewport })) showToast('Could not save — browser storage is full or disabled')
    }, 300)
    return () => clearTimeout(t)
  }, [boardId, elements, viewport])

  useEffect(() => {
    if (boardId) return
    const flush = () => saveBoard(latest.current)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [boardId])

  // ----- Collaboration -----
  useEffect(() => {
    if (!boardId) return
    // A fresh id per connection, so a replaced connection's departure never hides its successor.
    const clientId = newId()
    setMe((m) => ({ ...m, clientId }))
    const client = new SyncClient(boardId, { ...me, clientId }, {
      onState(els, initial) {
        board.applyRemote(els)
        if (initial && els.length === 0) {
          // A board just created from "Share": upload the private board's content.
          const seed = sanitizeElements(takeSeed(boardId))
          if (seed.length) board.update(() => seed)
        }
      },
      onStatus: setStatus,
      onPeers: setPeers,
      onError: showToast,
      onDeleted() {
        board.applyRemote([])
        setSelectedIds([])
        setDialog('deleted')
      },
      onUnauthorized() {
        setKeyRejected(loadAccessKey() !== '')
        setDialog('key')
      },
    }, initialKey)
    sync.current = client
    return () => {
      client.close()
      sync.current = null
    }
    // Identity changes are sent as presence, so `me` isn't a dependency (no reconnect on rename).
  }, [boardId])

  useEffect(() => {
    sync.current?.setPresence(cursor.current, selection, me)
  }, [selection, me])

  const onCursor = (p: Point | null) => {
    cursor.current = p
    sync.current?.setPresence(p, selection, me)
  }

  const share = async () => {
    if (!boardId) {
      // Turn the private board into a new shared one (the private copy stays as it is).
      const id = newBoardId()
      stashSeed(id, board.get())
      location.assign(`/board/${id}`)
      return
    }
    try {
      await navigator.clipboard.writeText(location.href)
      showToast('Link copied — anyone with it can view and edit this board')
    } catch {
      // Clipboard access can be refused; show the link for copying by hand.
      setDialog('link')
    }
  }

  const rename = () => setDialog('rename')

  const applyName = (name: string) => {
    const next = { ...me, name: name.slice(0, 40) }
    saveIdentity(next)
    setMe(next)
    setDialog(null)
  }

  useEffect(() => saveSettings({ pen, style, line: lineStyle, theme: themeSetting }), [pen, style, lineStyle, themeSetting])

  // The UI chrome follows `data-theme` via CSS variables; the board uses ThemeContext.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CANVAS[theme])
  }, [theme])

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
    const b = contentBounds(chosen(), board.get())
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null
  }

  // ----- Export -----
  const [exportOpen, setExportOpen] = useState(false)
  /** Remembered between exports in this session. */
  const [exportChoice, setExportChoice] = useState<ExportChoice>({
    format: 'png',
    selectionOnly: false,
    theme: 'light',
    background: 'solid',
    scale: 2,
    page: 'fit',
  })

  const openExport = () => {
    if (!board.get().length) {
      showToast('Nothing to export yet')
      return
    }
    setEditing(null)
    setExportOpen(true)
  }

  const runExport = async (choice: ExportChoice) => {
    setExportChoice(choice)
    const ids = choice.selectionOnly && selection.length ? new Set(selection) : null
    const opts = { ...choice, ids, boardId }
    let prepared: PreparedExport | null = null
    if (svgRef.current) {
      // Export is built from the rendered board, so render it in the export's
      // theme just long enough to snapshot it. Both switches happen in this one
      // task, so the browser never paints the intermediate state.
      flushSync(() => setRenderTheme(choice.theme))
      try {
        prepared = prepareExport(svgRef.current, board.get(), opts)
      } finally {
        flushSync(() => setRenderTheme(null))
      }
    }
    if (prepared) await deliverExport(prepared, opts)
    setExportOpen(false)
    if (!prepared) showToast('Nothing to export yet')
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
      // A label being edited or a dialog owns the keyboard.
      if (editing || exportOpen || dialog) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key

      if (key === ' ') {
        e.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (mod) {
        const k = key.toLowerCase()
        if (e.shiftKey && k === 'e') {
          e.preventDefault()
          openExport()
          return
        }
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
        l: () => setTool('line'),
        // "Arrow": the Line tool, making sure the end has an arrowhead.
        a: () => {
          setLineStyle((s) => (s.endCap === 'none' ? { ...s, endCap: 'triangle' } : s))
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

  // ----- Palette options area -----
  // Line tool → how new lines are drawn; anything selected (with a selecting
  // tool) → options that restyle the selection; otherwise nothing.
  const selectingTool = tool === 'select' || tool === 'move' || tool === 'scale' || tool === 'rotate'
  const selectedEls = elements.filter((el) => selSet.has(el.id))
  const optionPanel: OptionPanel | null =
    tool === 'line'
      ? { caption: 'Line', editing: false, items: lineToolOptions(lineStyle, (patch) => setLineStyle((s) => ({ ...s, ...patch }))) }
      : selectingTool && selectedEls.length
        ? {
            caption: 'Selected',
            editing: true,
            items: selectionOptions(selectedEls, paintFor(theme), {
              patch: actions.patch,
              lineDefaults: (patch) => setLineStyle((s) => ({ ...s, ...patch })),
            }),
          }
        : null

  return (
    <ThemeContext.Provider value={renderTheme ?? theme}>
    <div className="app">
      <Canvas
        board={board}
        viewport={viewport}
        onViewport={setViewport}
        tool={tool}
        onTool={setTool}
        shapeKind={shapeKind}
        lineStyle={lineStyle}
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
        peers={peers}
        onCursor={boardId ? onCursor : undefined}
      />
      <Palette
        tool={tool}
        shapeKind={shapeKind}
        pen={pen}
        panel={optionPanel}
        onTool={setTool}
        onShape={(kind) => {
          setShapeKind(kind)
          setTool('shape')
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
        onExport={openExport}
        theme={theme}
        themeSetting={themeSetting}
        onThemeSetting={setThemeSetting}
        collab={{
          shared: !!boardId,
          status,
          peers,
          me,
          onShare: share,
          onRename: rename,
          onNewShared: () => location.assign(`/board/${newBoardId()}`),
          onOpenPrivate: () => location.assign('/'),
          onUnlock: () => setDialog('key'),
        }}
        onSave={() => saveBoardFile(board.get())}
        onOpen={openFile}
        embedded={embedded}
        onClear={() => {
          if (board.get().length) setDialog('clear')
        }}
      />
      <div className="hint" aria-live="polite">
        {tool === 'select' && soleCurve ? CURVE_EDIT_HINT : HINTS[tool]}
      </div>
      {exportOpen && (
        <ExportDialog
          selectionCount={selection.length}
          initial={exportChoice}
          pngSize={(c) => pngSize(board.get(), c.selectionOnly && selection.length ? new Set(selection) : null, c.scale)}
          onExport={runExport}
          onClose={() => setExportOpen(false)}
        />
      )}
      {dialog === 'rename' && (
        <TextDialog
          title="Your name"
          label="Shown to others"
          initial={me.name}
          submitLabel="Save"
          maxLength={40}
          onSubmit={applyName}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'link' && (
        <TextDialog
          title="Share this board"
          label="Link"
          initial={location.href}
          submitLabel="Done"
          readOnly
          note="Copy the link (Ctrl+C) and send it. Anyone with it can view and edit this board."
          onSubmit={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'key' && (
        <TextDialog
          title="Access key required"
          label="Access key"
          initial=""
          submitLabel="Open board"
          maxLength={500}
          note={
            keyRejected
              ? 'That key wasn’t accepted. Check it with whoever runs this whiteboard.'
              : 'This whiteboard is private. Enter the access key you were given; this browser will remember it.'
          }
          onSubmit={(key) => {
            saveAccessKey(key)
            sync.current?.unlock(key)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'deleted' && (
        <ConfirmDialog
          title="Board deleted"
          message="An administrator deleted this board, so it no longer exists and changes here won't be saved."
          confirmLabel={embedded ? 'OK' : 'Open my private board'}
          onConfirm={() => (embedded ? setDialog(null) : location.assign('/'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'clear' && (
        <ConfirmDialog
          title="Clear board?"
          message={
            boardId
              ? 'This removes everything for everyone on this board. You can undo it.'
              : 'This removes everything on the board. You can undo it.'
          }
          confirmLabel="Clear board"
          danger
          onConfirm={() => {
            board.change(() => [])
            setSelectedIds([])
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
    </ThemeContext.Provider>
  )
}
