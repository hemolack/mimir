import { useEffect, useRef, useState } from 'react'
import type { PeerInfo, PeerPresence } from '../protocol'
import type { SyncStatus } from '../sync'
import type { Theme, ThemeSetting } from '../theme'
import { MenuIcon, MinusIcon, MoonIcon, PlusIcon, RedoIcon, ShareIcon, SunIcon, UndoIcon } from './icons'

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
  onExport(): void
  /** The theme being shown, and the user's setting (which may be 'system'). */
  theme: Theme
  themeSetting: ThemeSetting
  onThemeSetting(s: ThemeSetting): void
  onSave(): void
  onOpen(): void
  onClear(): void
  /** Inside another page: hide participants, Share, and anything that navigates the frame away. */
  embedded?: boolean
  collab: {
    shared: boolean
    status: SyncStatus
    peers: PeerPresence[]
    me: PeerInfo
    onShare(): void
    onRename(): void
    onNewShared(): void
    onOpenPrivate(): void
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

const STATUS_TEXT: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  online: 'Live — changes sync in real time',
  offline: 'Offline — reconnecting; your edits will sync when it’s back',
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

  const { collab } = p
  // Other people, one avatar each (several tabs of the same person show separately).
  const others = collab.peers.filter((peer) => peer.clientId !== collab.me.clientId)

  const statusDot = (
    <span className={`status-dot ${collab.status}`} title={STATUS_TEXT[collab.status]} role="img" aria-label={STATUS_TEXT[collab.status]} />
  )

  return (
    <div className="topbar">
      {p.embedded ? (
        // Embedded: just the connection status (live cursors still show on the canvas).
        collab.shared && <div className="panel row collab embed-status">{statusDot}</div>
      ) : (
      <div className="panel row collab">
        {collab.shared && (
          <>
            {statusDot}
            <button
              type="button"
              className="avatar me"
              style={{ background: collab.me.color }}
              title={`You (${collab.me.name}) — click to rename`}
              aria-label={`You: ${collab.me.name}. Rename`}
              onClick={collab.onRename}
            >
              {initials(collab.me.name)}
            </button>
            {others.slice(0, 5).map((peer) => (
              <span key={peer.clientId} className="avatar" style={{ background: peer.color }} title={peer.name} role="img" aria-label={peer.name}>
                {initials(peer.name)}
              </span>
            ))}
            {others.length > 5 && <span className="avatar more">+{others.length - 5}</span>}
          </>
        )}
        <button
          type="button"
          className="share-btn"
          title={collab.shared ? 'Copy link to this board' : 'Share: make a live copy of this board that others can join'}
          onClick={collab.onShare}
        >
          <ShareIcon />
          <span>{collab.shared ? 'Copy link' : 'Share'}</span>
        </button>
      </div>
      )}
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
      <div className="panel row menu-anchor" ref={menuRef}>
        <button
          type="button"
          className="tool-btn"
          title={p.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={p.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => p.onThemeSetting(p.theme === 'dark' ? 'light' : 'dark')}
        >
          {p.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
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
            <div className="menu-row" role="group" aria-label="Appearance">
              <span className="menu-row-label">Appearance</span>
              <div className="segmented">
                {(['system', 'light', 'dark'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={p.themeSetting === s}
                    className={p.themeSetting === s ? 'active' : ''}
                    onClick={() => p.onThemeSetting(s)}
                  >
                    {s === 'system' ? 'Auto' : s === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>
            <div className="menu-divider" role="separator" />
            {item('Zoom to fit', p.onZoomFit)}
            {!p.embedded && item('New shared board', collab.onNewShared)}
            {!p.embedded && collab.shared && item('Open my private board', collab.onOpenPrivate)}
            {collab.shared && item('Change my name…', collab.onRename)}
            {item('Export image or PDF…  (Ctrl+Shift+E)', p.onExport)}
            {item('Save to file…', p.onSave)}
            {item('Open file…', p.onOpen)}
            {item('Clear board', p.onClear, true)}
          </div>
        )}
      </div>
    </div>
  )
}
