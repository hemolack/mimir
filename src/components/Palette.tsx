import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { COLOR_NAMES, PEN_SIZES, SHAPES, STROKE_COLORS } from '../constants'
import { colorName, usePaint } from '../theme'
import type { PenSettings, ShapeKind, Tool } from '../types'
import {
  CurveIcon,
  EraserIcon,
  HandIcon,
  LineToolIcon,
  MoveIcon,
  PenIcon,
  RotateIcon,
  ScaleIcon,
  SelectIcon,
  ShapeIcon,
  TextIcon,
} from './icons'
import type { OptionPanel, PickOption } from './optionItems'

interface PaletteProps {
  tool: Tool
  shapeKind: ShapeKind
  pen: PenSettings
  /**
   * Options for the current tool or selection (Line tool, or whatever is
   * selected), shown at the bottom of the palette; null/absent shows none.
   * The Brush and Curve tools show their own brush settings instead.
   */
  panel?: OptionPanel | null
  onTool(tool: Tool): void
  onShape(kind: ShapeKind): void
  onPen(patch: Partial<PenSettings>): void
}

function ToolButton(props: { active: boolean; title: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`tool-btn${props.active ? ' active' : ''}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export function Palette(p: PaletteProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const paint = usePaint()

  const brushTool = p.tool === 'pen' || p.tool === 'curve'
  const panel = brushTool ? null : (p.panel ?? null)
  const items = panel?.items ?? []
  const open = items.find((i): i is PickOption => i.kind === 'pick' && i.id === openId) ?? null

  // Close the flyout when clicking anywhere else, or when its option goes away.
  useEffect(() => {
    if (!openId) return
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.tool-options, .line-flyout'))) setOpenId(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [openId])
  useEffect(() => {
    if (openId && !open) setOpenId(null)
  }, [openId, open])

  // Values set elsewhere (or on older boards) may not be one of the presets; show the number then.
  const nameOf = (item: PickOption) => item.choices.find((c) => c.value === item.value)?.name ?? String(item.value)

  return (
    <div className="palette-wrap">
      <nav className="palette panel" aria-label="Tools">
        <div className="palette-group">
          <ToolButton active={p.tool === 'select'} title="Select (V)" onClick={() => p.onTool('select')}>
            <SelectIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'hand'} title="Pan (H, or hold Space)" onClick={() => p.onTool('hand')}>
            <HandIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'move'} title="Move — drag anywhere to move the selection (M)" onClick={() => p.onTool('move')}>
            <MoveIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'scale'} title="Scale (S)" onClick={() => p.onTool('scale')}>
            <ScaleIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'rotate'} title="Rotate (Shift+R)" onClick={() => p.onTool('rotate')}>
            <RotateIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'line'} title="Line — style and arrows are set below (L)" onClick={() => p.onTool('line')}>
            <LineToolIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'pen'} title="Brush (P)" onClick={() => p.onTool('pen')}>
            <PenIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'curve'} title="Smooth curve — freehand to Bézier (B)" onClick={() => p.onTool('curve')}>
            <CurveIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'eraser'} title="Eraser (E)" onClick={() => p.onTool('eraser')}>
            <EraserIcon />
          </ToolButton>
          <ToolButton active={p.tool === 'text'} title="Text (T)" onClick={() => p.onTool('text')}>
            <TextIcon />
          </ToolButton>
        </div>

        <div className="palette-sep" />
        <div className="palette-group" role="group" aria-label="Shapes">
          {SHAPES.map((s) => (
            <ToolButton
              key={s.kind}
              active={p.tool === 'shape' && p.shapeKind === s.kind}
              title={s.key ? `${s.name} (${s.key.toUpperCase()})` : s.name}
              onClick={() => p.onShape(s.kind)}
            >
              <ShapeIcon kind={s.kind} />
            </ToolButton>
          ))}
        </div>

        {(brushTool || items.length > 0) && <div className="palette-sep" />}

        {brushTool && (
          <div className="tool-options brush-options" role="group" aria-label={p.tool === 'pen' ? 'Brush options' : 'Curve options'}>
            <span className="palette-caption">{p.tool === 'pen' ? 'Brush' : 'Curve'}</span>
            <div className="mini-swatches" role="radiogroup" aria-label="Color">
              {STROKE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={p.pen.color === c}
                  className={`mini-swatch${p.pen.color === c ? ' active' : ''}`}
                  style={{ background: paint.ink(c) }}
                  title={colorName(COLOR_NAMES, c, paint.theme)}
                  aria-label={colorName(COLOR_NAMES, c, paint.theme)}
                  onClick={() => p.onPen({ color: c })}
                />
              ))}
            </div>
            <div className="mini-sizes" role="radiogroup" aria-label="Size">
              {PEN_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={p.pen.size === s}
                  className={`mini-size${p.pen.size === s ? ' active' : ''}`}
                  title={`Size ${s}`}
                  aria-label={`Size ${s}`}
                  onClick={() => p.onPen({ size: s })}
                >
                  <span className="dot" style={{ width: Math.min(s + 1, 12), height: Math.min(s + 1, 12) }} />
                </button>
              ))}
            </div>
            {p.tool === 'pen' && (
              <button
                type="button"
                className={`highlighter-toggle${p.pen.highlighter ? ' active' : ''}`}
                aria-pressed={p.pen.highlighter}
                onClick={() => p.onPen({ highlighter: !p.pen.highlighter })}
              >
                Highlighter
              </button>
            )}
          </div>
        )}

        {panel && items.length > 0 && (
          <div
            className={`tool-options line-options${panel.editing ? ' editing' : ''}`}
            role="group"
            aria-label={panel.editing ? 'Options for the selection' : `${panel.caption} options`}
          >
            <span className="palette-caption">{panel.caption}</span>
            <div className="palette-group">
              {items.map((item) =>
                item.kind === 'toggle' ? (
                  <button
                    key={item.id}
                    type="button"
                    className={`tool-btn text${item.active ? ' active' : ''}`}
                    title={item.title}
                    aria-label={item.title}
                    aria-pressed={item.active}
                    onClick={item.onToggle}
                  >
                    {item.label}
                  </button>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className={`tool-btn${openId === item.id ? ' active' : ''}`}
                    title={`${item.title}: ${nameOf(item)}`}
                    aria-label={`${item.title}: ${nameOf(item)}`}
                    aria-haspopup="true"
                    aria-expanded={openId === item.id}
                    onClick={() => setOpenId((o) => (o === item.id ? null : item.id))}
                  >
                    {item.buttonIcon}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
      </nav>

      {open && (
        <div className="line-flyout panel" role="group" aria-label={open.title}>
          <div className="flyout-title">{open.title}</div>
          <div className="flyout-grid">
            {open.choices.map((c) => {
              const active = open.value === c.value
              return (
                <button
                  key={String(c.value)}
                  type="button"
                  className={`flyout-option${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    open.onPick(c.value)
                    setOpenId(null)
                  }}
                >
                  {c.icon}
                  <span>{c.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
