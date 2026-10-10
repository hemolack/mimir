import { useLayoutEffect, useRef, useState } from 'react'
import { COLOR_NAMES, FILL_COLORS, FONT_SIZES, LINE_CAPS, LINE_DASHES, LINE_ROUTES, STROKE_COLORS, STROKE_WIDTHS } from '../constants'
import { isLabelable } from '../ops'
import { colorName, usePaint } from '../theme'
import type { BoardElement, CurveElement, Rect, ShapeElement, StyleDefaults } from '../types'
import {
  BackIcon,
  CapIcon,
  CopyIcon,
  CornerPointIcon,
  DeletePointIcon,
  FlipHIcon,
  FlipVIcon,
  Rotate90Icon,
  RouteIcon,
  SmoothPointIcon,
  FrontIcon,
  LabelIcon,
  LineIcon,
  TrashIcon,
} from './icons'

type Popover = 'stroke' | 'fill' | 'style' | 'caps' | null

export interface ContextMenuProps {
  selected: BoardElement[]
  /** Selection bounds in screen coordinates relative to the canvas. */
  anchor: Rect
  container: { w: number; h: number }
  onPatch(fn: (el: BoardElement) => BoardElement, style?: Partial<StyleDefaults>): void
  onEditLabel(): void
  onDuplicate(): void
  onDelete(): void
  onFront(): void
  onBack(): void
  onRotate90(): void
  onFlip(axis: 'x' | 'y'): void
  /** Present while a curve point is chosen. */
  nodeActions?: { smooth: boolean; onToggleSmooth(): void; onDelete(): void }
}


/** A color choice. `shown` is how the color looks in the current theme (it may differ from the stored value). */
function Swatch(props: { color: string; shown: string; active: boolean; onClick(): void; label: string }) {
  const { color, shown, active, onClick, label } = props
  return (
    <button
      type="button"
      className={`swatch${active ? ' active' : ''}${color === 'none' ? ' none' : ''}`}
      style={color === 'none' ? undefined : { background: shown }}
      title={label}
      aria-label={label}
      onClick={onClick}
    />
  )
}

export function ContextMenu(p: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Popover>(null)
  const paint = usePaint()

  const first = p.selected[0]
  const shapes = p.selected.filter((el) => el.type === 'shape')
  const lines = p.selected.filter((el) => el.type === 'line')
  const curves = p.selected.filter((el) => el.type === 'curve')
  const fillable = p.selected.filter(
    (el): el is ShapeElement | CurveElement => el.type === 'shape' || (el.type === 'curve' && el.closed),
  )
  const hasText = shapes.length > 0 || lines.length > 0
  const onlyLines = lines.length > 0 && lines.length === p.selected.length
  const single = p.selected.length === 1 && isLabelable(first) ? first : null

  const stroke = first.stroke
  const fill = fillable[0]?.fill
  const outlined = shapes[0] ?? lines[0] ?? curves[0]
  const line = lines[0]

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const cx = p.anchor.x + p.anchor.w / 2
    const left = Math.min(Math.max(8, cx - w / 2), Math.max(8, p.container.w - w - 8))
    let top = p.anchor.y - h - 14
    if (top < 8) top = p.anchor.y + p.anchor.h + 14
    if (top + h > p.container.h - 8) top = 8
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  })

  const toggle = (which: Popover) => setOpen((o) => (o === which ? null : which))

  return (
    <div
      ref={ref}
      className="context-menu panel"
      role="toolbar"
      aria-label="Selection"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="row">
        {p.nodeActions && (
          <>
            <button
              type="button"
              className="tool-btn small"
              title={p.nodeActions.smooth ? 'Make corner point (double-click point)' : 'Make smooth point (double-click point)'}
              aria-label={p.nodeActions.smooth ? 'Make corner point' : 'Make smooth point'}
              onClick={p.nodeActions.onToggleSmooth}
            >
              {p.nodeActions.smooth ? <CornerPointIcon /> : <SmoothPointIcon />}
            </button>
            <button
              type="button"
              className="tool-btn small danger"
              title="Delete point (Del)"
              aria-label="Delete point"
              onClick={p.nodeActions.onDelete}
            >
              <DeletePointIcon />
            </button>
            <span className="menu-sep" />
          </>
        )}
        {single && (
          <button type="button" className="tool-btn small" title="Edit label (Enter)" aria-label="Edit label" onClick={p.onEditLabel}>
            <LabelIcon />
          </button>
        )}
        <button
          type="button"
          className={`tool-btn small${open === 'stroke' ? ' active' : ''}`}
          title="Stroke color"
          aria-label="Stroke color"
          onClick={() => toggle('stroke')}
        >
          <span className="color-chip" style={{ borderColor: paint.ink(stroke), background: 'transparent' }} />
        </button>
        {fillable.length > 0 && (
          <button
            type="button"
            className={`tool-btn small${open === 'fill' ? ' active' : ''}`}
            title="Fill color"
            aria-label="Fill color"
            onClick={() => toggle('fill')}
          >
            <span
              className={`color-chip filled${fill === 'none' ? ' none' : ''}`}
              style={fill && fill !== 'none' ? { background: paint.fill(fill) } : undefined}
            />
          </button>
        )}
        {outlined && (
          <button
            type="button"
            className={`tool-btn small${open === 'style' ? ' active' : ''}`}
            title="Line and text style"
            aria-label="Line and text style"
            onClick={() => toggle('style')}
          >
            <LineIcon style={{ dash: outlined.dash }} />
          </button>
        )}
        {lines.length > 0 && (
          <button
            type="button"
            className={`tool-btn small${open === 'caps' ? ' active' : ''}`}
            title="Arrowheads and routing"
            aria-label="Arrowheads and routing"
            onClick={() => toggle('caps')}
          >
            <LineIcon style={{ startCap: line.startCap, endCap: line.endCap, routing: line.routing }} />
          </button>
        )}
        <span className="menu-sep" />
        <button type="button" className="tool-btn small" title="Rotate 90° clockwise" aria-label="Rotate 90 degrees" onClick={p.onRotate90}>
          <Rotate90Icon />
        </button>
        <button type="button" className="tool-btn small" title="Flip horizontally" aria-label="Flip horizontally" onClick={() => p.onFlip('x')}>
          <FlipHIcon />
        </button>
        <button type="button" className="tool-btn small" title="Flip vertically" aria-label="Flip vertically" onClick={() => p.onFlip('y')}>
          <FlipVIcon />
        </button>
        <span className="menu-sep" />
        <button type="button" className="tool-btn small" title="Bring to front" aria-label="Bring to front" onClick={p.onFront}>
          <FrontIcon />
        </button>
        <button type="button" className="tool-btn small" title="Send to back" aria-label="Send to back" onClick={p.onBack}>
          <BackIcon />
        </button>
        <button type="button" className="tool-btn small" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={p.onDuplicate}>
          <CopyIcon />
        </button>
        <button type="button" className="tool-btn small danger" title="Delete (Del)" aria-label="Delete" onClick={p.onDelete}>
          <TrashIcon />
        </button>
      </div>

      {open === 'stroke' && (
        <div className="popover">
          <div className="swatches">
            {STROKE_COLORS.map((c) => (
              <Swatch
                key={c}
                color={c}
                shown={paint.ink(c)}
                label={`Stroke: ${colorName(COLOR_NAMES, c, paint.theme)}`}
                active={stroke === c}
                onClick={() => p.onPatch((el) => ({ ...el, stroke: c }), { stroke: c })}
              />
            ))}
          </div>
        </div>
      )}

      {open === 'fill' && (
        <div className="popover">
          <div className="swatches">
            {FILL_COLORS.map((c) => (
              <Swatch
                key={c}
                color={c}
                shown={paint.fill(c)}
                label={c === 'none' ? 'No fill' : `Fill ${c}`}
                active={fill === c}
                onClick={() =>
                  p.onPatch(
                    (el) => (el.type === 'shape' || (el.type === 'curve' && el.closed) ? { ...el, fill: c } : el),
                    { fill: c },
                  )
                }
              />
            ))}
          </div>
        </div>
      )}

      {open === 'style' && outlined && (
        <div className="popover">
          <div className="popover-row">
            <span className="popover-label">Width</span>
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`tool-btn small${outlined.strokeWidth === w ? ' active' : ''}`}
                title={`Stroke width ${w}`}
                aria-label={`Stroke width ${w}`}
                onClick={() => p.onPatch((el) => (el.type === 'path' ? el : { ...el, strokeWidth: w }), { strokeWidth: w })}
              >
                <span className="bar" style={{ height: w }} />
              </button>
            ))}
          </div>
          <div className="popover-row">
            <span className="popover-label">Style</span>
            {/* Double is a line style; it's offered only when every selected item is a line. */}
            {LINE_DASHES.filter((d) => d.value !== 'double' || onlyLines).map(({ value: d, name }) => (
              <button
                key={d}
                type="button"
                className={`tool-btn small${outlined.dash === d ? ' active' : ''}`}
                title={name}
                aria-label={`${name} stroke`}
                onClick={() =>
                  p.onPatch((el) => (el.type === 'path' ? el : { ...el, dash: d }), d === 'double' ? undefined : { dash: d })
                }
              >
                <LineIcon style={{ dash: d }} />
              </button>
            ))}
          </div>
          {hasText && (
            <div className="popover-row">
              <span className="popover-label">Text</span>
              {FONT_SIZES.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`tool-btn small text${(shapes[0] ?? lines[0])?.fontSize === s ? ' active' : ''}`}
                  title={`Font size ${s}`}
                  aria-label={`Font size ${s}`}
                  onClick={() =>
                    p.onPatch((el) => (el.type === 'shape' || el.type === 'line' ? { ...el, fontSize: s } : el), {
                      fontSize: s,
                    })
                  }
                >
                  {['S', 'M', 'L', 'XL'][i]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {open === 'caps' && line && (
        <div className="popover">
          <div className="popover-row">
            <span className="popover-label">Start</span>
            {LINE_CAPS.map(({ value: c, name }) => (
              <button
                key={c}
                type="button"
                className={`tool-btn small${line.startCap === c ? ' active' : ''}`}
                title={`Start: ${name}`}
                aria-label={`Start: ${name}`}
                onClick={() => p.onPatch((el) => (el.type === 'line' ? { ...el, startCap: c } : el))}
              >
                <CapIcon cap={c} flip />
              </button>
            ))}
          </div>
          <div className="popover-row">
            <span className="popover-label">End</span>
            {LINE_CAPS.map(({ value: c, name }) => (
              <button
                key={c}
                type="button"
                className={`tool-btn small${line.endCap === c ? ' active' : ''}`}
                title={`End: ${name}`}
                aria-label={`End: ${name}`}
                onClick={() => p.onPatch((el) => (el.type === 'line' ? { ...el, endCap: c } : el))}
              >
                <CapIcon cap={c} />
              </button>
            ))}
          </div>
          <div className="popover-row">
            <span className="popover-label">Route</span>
            {LINE_ROUTES.map(({ value: r, name }) => (
              <button
                key={r}
                type="button"
                className={`tool-btn small${line.routing === r ? ' active' : ''}`}
                title={name}
                aria-label={`Route: ${name}`}
                onClick={() => p.onPatch((el) => (el.type === 'line' ? { ...el, routing: r } : el))}
              >
                <RouteIcon routing={r} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
