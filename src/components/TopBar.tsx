import { useEffect, useRef, useState } from 'react'
import { MenuIcon, MinusIcon, PlusIcon, RedoIcon, UndoIcon } from './icons'

interface TopBarProps {
  zoom: number
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  onZoomIn(): void
  onZoomOut(): void
  onZoomReset(): void
  onZoomFit(): void
  onExportSvg(): void
  onExportPng(): void
  onSave(): void
  onOpen(): void
  onClear(): void
}

export function TopBar(p: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const item = (label: string, fn: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? ' danger' : ''}`}
      onClick={() => {
        setMenuOpen(false)
        fn()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="topbar">
      <div className="panel row">
        <button type="button" className="tool-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
          <UndoIcon />
        </button>
        <button type="button" className="tool-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
          <RedoIcon />
        </button>
      </div>
      <div className="panel row">
        <button type="button" className="tool-btn small" title="Zoom out" aria-label="Zoom out" onClick={p.onZoomOut}>
          <MinusIcon />
        </button>
        <button type="button" className="zoom-label" title="Reset zoom" onClick={p.onZoomReset}>
          {Math.round(p.zoom * 100)}%
        </button>
        <button type="button" className="tool-btn small" title="Zoom in" aria-label="Zoom in" onClick={p.onZoomIn}>
          <PlusIcon />
        </button>
      </div>
      <div className="panel menu-anchor" ref={menuRef}>
        <button
          type="button"
          className={`tool-btn${menuOpen ? ' active' : ''}`}
          title="Menu"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <MenuIcon />
        </button>
        {menuOpen && (
          <div className="menu panel" role="menu">
            {item('Zoom to fit', p.onZoomFit)}
            {item('Export as SVG', p.onExportSvg)}
            {item('Export as PNG', p.onExportPng)}
            {item('Save to file…', p.onSave)}
            {item('Open file…', p.onOpen)}
            {item('Clear board', p.onClear, true)}
          </div>
        )}
      </div>
    </div>
  )
}
