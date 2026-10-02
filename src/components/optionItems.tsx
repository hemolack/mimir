import type { ReactNode } from 'react'
import {
  COLOR_NAMES,
  FILL_COLORS,
  FONT_SIZES,
  LINE_CAPS,
  LINE_DASHES,
  LINE_ROUTES,
  PEN_SIZES,
  STROKE_COLORS,
  STROKE_WIDTHS,
} from '../constants'
import { colorName } from '../theme'
import type { Paint } from '../theme'
import type { BoardElement, Cap, DashStyle, LineStyle, Routing, StyleDefaults } from '../types'
import { CapIcon, LineIcon, RouteIcon } from './icons'

/**
 * The palette's options area is a list of these: each is a button that opens a
 * flyout of choices, or a simple on/off toggle. The Line tool and every kind of
 * selection describe their options this way, so the palette needn't know what
 * it's editing.
 */
export interface Choice {
  value: string | number
  name: string
  icon: ReactNode
}

export interface PickOption {
  kind: 'pick'
  id: string
  title: string
  /** The current value (first selected element's, for mixed selections). */
  value: string | number
  choices: Choice[]
  /** What the button shows for the current value. */
  buttonIcon: ReactNode
  onPick(value: string | number): void
}

export interface ToggleOption {
  kind: 'toggle'
  id: string
  title: string
  active: boolean
  label: ReactNode
  onToggle(): void
}

export type OptionItem = PickOption | ToggleOption

export interface OptionPanel {
  /** Short caption above the options ("Line", "Selected"). */
  caption: string
  /** True when the options edit selected elements rather than a tool's defaults. */
  editing: boolean
  items: OptionItem[]
}

// ---------- shared choice lists ----------

const WIDTH_NAMES = ['Thin', 'Medium', 'Bold', 'Extra bold']
const SIZE_NAMES = ['Fine', 'Medium', 'Thick', 'Marker']
const TEXT_NAMES = ['Small', 'Medium', 'Large', 'Extra large']

const Dot = ({ color, size = 16, empty = false }: { color?: string; size?: number; empty?: boolean }) => (
  <span
    className={`choice-swatch${empty ? ' none' : ''}`}
    style={{ width: size, height: size, ...(empty ? {} : { background: color }) }}
    aria-hidden="true"
  />
)
const Bar = ({ height }: { height: number }) => <span className="bar" style={{ height }} aria-hidden="true" />
const SizeDot = ({ size }: { size: number }) => (
  <span className="dot" style={{ width: Math.min(size + 1, 16), height: Math.min(size + 1, 16) }} aria-hidden="true" />
)
const TextGlyph = ({ index }: { index: number }) => (
  <span className="text-glyph" style={{ fontSize: 10 + index * 3 }} aria-hidden="true">
    A
  </span>
)

const dashChoices = (includeDouble: boolean): Choice[] =>
  LINE_DASHES.filter((d) => includeDouble || d.value !== 'double').map((d) => ({
    value: d.value,
    name: d.name,
    icon: <LineIcon style={{ dash: d.value }} />,
  }))

const capChoices = (flip: boolean): Choice[] =>
  LINE_CAPS.map((c) => ({ value: c.value, name: c.name, icon: <CapIcon cap={c.value} flip={flip} /> }))

const routeChoices: Choice[] = LINE_ROUTES.map((r) => ({ value: r.value, name: r.name, icon: <RouteIcon routing={r.value} /> }))

// ---------- Line tool ----------

/** Options for the Line tool itself: how the next line will be drawn. */
export function lineToolOptions(style: LineStyle, onChange: (patch: Partial<LineStyle>) => void): OptionItem[] {
  return [
    {
      kind: 'pick',
      id: 'dash',
      title: 'Line style',
      value: style.dash,
      choices: dashChoices(true),
      buttonIcon: <LineIcon style={{ dash: style.dash }} />,
      onPick: (v) => onChange({ dash: v as DashStyle }),
    },
    {
      kind: 'pick',
      id: 'startCap',
      title: 'Start',
      value: style.startCap,
      choices: capChoices(true),
      buttonIcon: <CapIcon cap={style.startCap} flip />,
      onPick: (v) => onChange({ startCap: v as Cap }),
    },
    {
      kind: 'pick',
      id: 'endCap',
      title: 'End',
      value: style.endCap,
      choices: capChoices(false),
      buttonIcon: <CapIcon cap={style.endCap} />,
      onPick: (v) => onChange({ endCap: v as Cap }),
    },
    {
      kind: 'pick',
      id: 'routing',
      title: 'Route',
      value: style.routing,
      choices: routeChoices,
      buttonIcon: <RouteIcon routing={style.routing} />,
      onPick: (v) => onChange({ routing: v as Routing }),
    },
  ]
}

// ---------- Selection ----------

export interface SelectionOptionHandlers {
  /** Apply `fn` to every selected element (one undo step); optionally remember the style for new elements. */
  patch(fn: (el: BoardElement) => BoardElement, style?: Partial<StyleDefaults>): void
  /** Remember line options as the Line tool's defaults too. */
  lineDefaults(patch: Partial<LineStyle>): void
}

/**
 * Options for whatever is selected. Each option appears only if something in
 * the selection has that property, and applies only to those elements.
 */
export function selectionOptions(selected: BoardElement[], paint: Paint, h: SelectionOptionHandlers): OptionItem[] {
  const shapes = selected.filter((el) => el.type === 'shape')
  const boxes = shapes.filter((el) => el.kind !== 'text') // shapes with an outline
  const lines = selected.filter((el) => el.type === 'line')
  const curves = selected.filter((el) => el.type === 'curve')
  const paths = selected.filter((el) => el.type === 'path')
  const fillable = [...boxes, ...curves.filter((c) => c.closed)]
  const outlined = [...boxes, ...lines, ...curves]
  const labeled = [...shapes, ...lines]
  const items: OptionItem[] = []
  if (selected.length === 0) return items

  // Color: every element has one (stroke, text color or brush color).
  const color = selected[0].stroke
  items.push({
    kind: 'pick',
    id: 'color',
    title: 'Color',
    value: color,
    choices: STROKE_COLORS.map((c) => ({ value: c, name: colorName(COLOR_NAMES, c, paint.theme), icon: <Dot color={paint.ink(c)} /> })),
    buttonIcon: <span className="color-chip" style={{ borderColor: paint.ink(color), background: 'transparent' }} />,
    onPick: (v) => h.patch((el) => ({ ...el, stroke: String(v) }), { stroke: String(v) }),
  })

  if (fillable.length) {
    const fill = fillable[0].fill
    items.push({
      kind: 'pick',
      id: 'fill',
      title: 'Fill',
      value: fill,
      choices: FILL_COLORS.map((c) => ({
        value: c,
        name: c === 'none' ? 'No fill' : (FILL_NAMES[c] ?? c),
        icon: c === 'none' ? <Dot empty /> : <Dot color={paint.fill(c)} />,
      })),
      buttonIcon: (
        <span className={`color-chip filled${fill === 'none' ? ' none' : ''}`} style={fill === 'none' ? undefined : { background: paint.fill(fill) }} />
      ),
      onPick: (v) =>
        h.patch(
          (el) => (el.type === 'shape' && el.kind !== 'text') || (el.type === 'curve' && el.closed) ? { ...el, fill: String(v) } : el,
          { fill: String(v) },
        ),
    })
  }

  if (outlined.length) {
    const width = outlined[0].strokeWidth
    items.push({
      kind: 'pick',
      id: 'width',
      title: 'Width',
      value: width,
      choices: STROKE_WIDTHS.map((w, i) => ({ value: w, name: WIDTH_NAMES[i], icon: <Bar height={w} /> })),
      buttonIcon: <Bar height={Math.min(width, 6)} />,
      onPick: (v) =>
        h.patch((el) => (el.type === 'path' || (el.type === 'shape' && el.kind === 'text') ? el : { ...el, strokeWidth: Number(v) }), {
          strokeWidth: Number(v),
        }),
    })

    const dash = outlined[0].dash
    const onlyLines = lines.length === selected.length
    items.push({
      kind: 'pick',
      id: 'dash',
      title: 'Style',
      value: dash,
      // Double is a line style; offered only when everything selected is a line.
      choices: dashChoices(onlyLines),
      buttonIcon: <LineIcon style={{ dash }} />,
      onPick: (v) => {
        const d = v as DashStyle
        h.patch(
          (el) => (el.type === 'path' || (el.type === 'shape' && el.kind === 'text') ? el : { ...el, dash: d }),
          d === 'double' ? undefined : { dash: d },
        )
        if (lines.length) h.lineDefaults({ dash: d })
      },
    })
  }

  if (paths.length) {
    const first = paths[0]
    const base = first.highlighter ? first.size / 3 : first.size
    items.push({
      kind: 'pick',
      id: 'size',
      title: 'Size',
      value: base,
      choices: PEN_SIZES.map((s, i) => ({ value: s, name: SIZE_NAMES[i], icon: <SizeDot size={s} /> })),
      buttonIcon: <SizeDot size={base} />,
      onPick: (v) => h.patch((el) => (el.type === 'path' ? { ...el, size: el.highlighter ? Number(v) * 3 : Number(v) } : el)),
    })
    const allHighlighter = paths.every((p) => p.highlighter)
    items.push({
      kind: 'toggle',
      id: 'highlighter',
      title: allHighlighter ? 'Make regular strokes' : 'Make highlighter strokes',
      active: allHighlighter,
      label: 'HL',
      onToggle: () =>
        h.patch((el) => {
          if (el.type !== 'path' || el.highlighter === !allHighlighter) return el
          const on = !allHighlighter
          return { ...el, highlighter: on, opacity: on ? 0.4 : 1, size: on ? el.size * 3 : el.size / 3 }
        }),
    })
  }

  if (lines.length) {
    const line = lines[0]
    const linePick = (id: 'startCap' | 'endCap', title: string, flip: boolean): PickOption => ({
      kind: 'pick',
      id,
      title,
      value: line[id],
      choices: capChoices(flip),
      buttonIcon: <CapIcon cap={line[id]} flip={flip} />,
      onPick: (v) => {
        h.patch((el) => (el.type === 'line' ? { ...el, [id]: v as Cap } : el))
        h.lineDefaults({ [id]: v as Cap })
      },
    })
    items.push(linePick('startCap', 'Start', true), linePick('endCap', 'End', false), {
      kind: 'pick',
      id: 'routing',
      title: 'Route',
      value: line.routing,
      choices: routeChoices,
      buttonIcon: <RouteIcon routing={line.routing} />,
      onPick: (v) => {
        h.patch((el) => (el.type === 'line' ? { ...el, routing: v as Routing } : el))
        h.lineDefaults({ routing: v as Routing })
      },
    })
  }

  if (labeled.length) {
    const size = labeled[0].fontSize
    const index = Math.max(0, FONT_SIZES.indexOf(size))
    items.push({
      kind: 'pick',
      id: 'fontSize',
      title: 'Text size',
      value: size,
      choices: FONT_SIZES.map((s, i) => ({ value: s, name: TEXT_NAMES[i], icon: <TextGlyph index={i} /> })),
      buttonIcon: <TextGlyph index={index} />,
      onPick: (v) =>
        h.patch((el) => (el.type === 'shape' || el.type === 'line' ? { ...el, fontSize: Number(v) } : el), { fontSize: Number(v) }),
    })
  }

  return items
}

/** Names for the fill palette (tooltips and screen readers). */
const FILL_NAMES: Record<string, string> = {
  '#ffffff': 'White',
  '#ffc9c9': 'Light red',
  '#ffec99': 'Light yellow',
  '#b2f2bb': 'Light green',
  '#a5d8ff': 'Light blue',
  '#99e9f2': 'Light cyan',
  '#eebefa': 'Light purple',
  '#e9ecef': 'Light gray',
}
