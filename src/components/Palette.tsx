import type { ReactNode } from 'react'
import { LINE_PRESETS, PEN_SIZES, SHAPES, STROKE_COLORS } from '../constants'
import type { PenSettings, ShapeKind, Tool } from '../types'
import { CurveIcon, EraserIcon, HandIcon, MoveIcon, RotateIcon, ScaleIcon, LineIcon, PenIcon, SelectIcon, ShapeIcon, TextIcon } from './icons'

interface PaletteProps {
  tool: Tool
  shapeKind: ShapeKind
  linePreset: number
  pen: PenSettings
  onTool(tool: Tool): void
  onShape(kind: ShapeKind): void
  onLinePreset(index: number): void
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
        <div className="palette-group" role="group" aria-label="Lines">
          {LINE_PRESETS.map((preset, i) => (
            <ToolButton
              key={preset.name}
              active={p.tool === 'line' && p.linePreset === i}
              title={i === 0 ? `${preset.name} (L)` : i === 1 ? `${preset.name} (A)` : preset.name}
              onClick={() => p.onLinePreset(i)}
            >
              <LineIcon preset={preset} />
            </ToolButton>
          ))}
        </div>
      </nav>

      {(p.tool === 'pen' || p.tool === 'curve') && (
        <div className="pen-panel panel" role="group" aria-label={p.tool === 'pen' ? 'Brush settings' : 'Curve settings'}>
          <div className="swatches">
            {STROKE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${p.pen.color === c ? ' active' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={`Brush color ${c}`}
                onClick={() => p.onPen({ color: c })}
              />
            ))}
          </div>
          <div className="row">
            {PEN_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={`tool-btn small${p.pen.size === s ? ' active' : ''}`}
                title={`Size ${s}`}
                aria-label={`Brush size ${s}`}
                onClick={() => p.onPen({ size: s })}
              >
                <span className="dot" style={{ width: Math.min(s + 2, 16), height: Math.min(s + 2, 16) }} />
              </button>
            ))}
            {p.tool === 'pen' && (
              <button
                type="button"
                className={`tool-btn small text${p.pen.highlighter ? ' active' : ''}`}
                title="Highlighter"
                aria-pressed={p.pen.highlighter}
                onClick={() => p.onPen({ highlighter: !p.pen.highlighter })}
              >
                HL
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
