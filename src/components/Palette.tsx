import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { COLOR_NAMES, LINE_CAPS, LINE_DASHES, LINE_ROUTES, PEN_SIZES, SHAPES, STROKE_COLORS } from '../constants'
import type { LineStyle, PenSettings, ShapeKind, Tool } from '../types'
import {
  CapIcon,
  CurveIcon,
  EraserIcon,
  HandIcon,
  LineIcon,
  LineToolIcon,
  MoveIcon,
  PenIcon,
  RotateIcon,
  RouteIcon,
  ScaleIcon,
  SelectIcon,
  ShapeIcon,
  TextIcon,
} from './icons'

interface PaletteProps {
  tool: Tool
  shapeKind: ShapeKind
  pen: PenSettings
  /** What the line options show: the selected lines' style, or the Line tool's. */
  lineStyle: LineStyle
  /** True when the line options are editing selected lines rather than the tool. */
  editingSelectedLines: boolean
  onTool(tool: Tool): void
  onShape(kind: ShapeKind): void
  onPen(patch: Partial<PenSettings>): void
  onLineStyle(patch: Partial<LineStyle>): void
}

type LineOption = 'dash' | 'startCap' | 'endCap' | 'routing'

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

const OPTION_TITLES: Record<LineOption, string> = {
  dash: 'Line style',
  startCap: 'Start',
  endCap: 'End',
  routing: 'Route',
}

/** Icon for one value of one line option. */
function optionIcon(option: LineOption, value: string) {
  switch (option) {
    case 'dash':
      return <LineIcon style={{ dash: value as LineStyle['dash'] }} />
    case 'startCap':
      return <CapIcon cap={value as LineStyle['startCap']} flip />
    case 'endCap':
      return <CapIcon cap={value as LineStyle['endCap']} />
    case 'routing':
      return <RouteIcon routing={value as LineStyle['routing']} />
  }
}

const CHOICES: Record<LineOption, { value: string; name: string }[]> = {
  dash: LINE_DASHES,
  startCap: LINE_CAPS,
  endCap: LINE_CAPS,
  routing: LINE_ROUTES,
}

export function Palette(p: PaletteProps) {
  const [open, setOpen] = useState<LineOption | null>(null)

  // Close the flyout when clicking anywhere else.
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.line-options, .line-flyout'))) setOpen(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const brushTool = p.tool === 'pen' || p.tool === 'curve'
  // The line flyout belongs to the line options; drop it when brush options take the area.
  useEffect(() => {
    if (brushTool) setOpen(null)
  }, [brushTool])

  const nameOf = (option: LineOption) => CHOICES[option].find((c) => c.value === p.lineStyle[option])?.name ?? ''

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

        <div className="palette-sep" />
        {/* Tool options: brush settings while drawing freehand, line options otherwise. */}
        {brushTool ? (
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
                  style={{ background: c }}
                  title={COLOR_NAMES[c] ?? c}
                  aria-label={COLOR_NAMES[c] ?? c}
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
        ) : (
          <div
            className={`tool-options line-options${p.editingSelectedLines ? ' editing' : ''}`}
            role="group"
            aria-label={p.editingSelectedLines ? 'Line options (selected lines)' : 'Line options (Line tool)'}
          >
            <span className="palette-caption">{p.editingSelectedLines ? 'Selected' : 'Line'}</span>
            <div className="palette-group">
              {(['dash', 'startCap', 'endCap', 'routing'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`tool-btn${open === option ? ' active' : ''}`}
                  title={`${OPTION_TITLES[option]}: ${nameOf(option)}`}
                  aria-label={`${OPTION_TITLES[option]}: ${nameOf(option)}`}
                  aria-haspopup="true"
                  aria-expanded={open === option}
                  onClick={() => setOpen((o) => (o === option ? null : option))}
                >
                  {optionIcon(option, p.lineStyle[option])}
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {open && !brushTool && (
        <div className="line-flyout panel" role="group" aria-label={OPTION_TITLES[open]}>
          <div className="flyout-title">{OPTION_TITLES[open]}</div>
          <div className="flyout-grid">
            {CHOICES[open].map((c) => {
              const active = p.lineStyle[open] === c.value
              return (
                <button
                  key={c.value}
                  type="button"
                  className={`flyout-option${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    p.onLineStyle({ [open]: c.value } as Partial<LineStyle>)
                    setOpen(null)
                  }}
                >
                  {optionIcon(open, c.value)}
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
