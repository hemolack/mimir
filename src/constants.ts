import type { LinePreset, PenSettings, ShapeKind, StyleDefaults } from './types'

export const FONT_FAMILY =
  'ui-rounded, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

export const STROKE_COLORS = [
  '#1e1e1e',
  '#e03131',
  '#f08c00',
  '#2f9e44',
  '#1971c2',
  '#0c8599',
  '#9c36b5',
  '#868e96',
]

export const FILL_COLORS = [
  'none',
  '#ffffff',
  '#ffc9c9',
  '#ffec99',
  '#b2f2bb',
  '#a5d8ff',
  '#99e9f2',
  '#eebefa',
  '#e9ecef',
]

export const STROKE_WIDTHS = [1, 2, 4, 6]
export const FONT_SIZES = [14, 18, 24, 36]
export const PEN_SIZES = [2, 4, 8, 16]

export const SHAPES: { kind: ShapeKind; name: string; key?: string }[] = [
  { kind: 'rectangle', name: 'Rectangle', key: 'r' },
  { kind: 'rounded', name: 'Rounded rectangle' },
  { kind: 'square', name: 'Square' },
  { kind: 'circle', name: 'Circle', key: 'c' },
  { kind: 'ellipse', name: 'Oval', key: 'o' },
  { kind: 'diamond', name: 'Diamond (decision)', key: 'd' },
  { kind: 'triangle', name: 'Triangle' },
  { kind: 'parallelogram', name: 'Parallelogram (input/output)' },
  { kind: 'hexagon', name: 'Hexagon (preparation)' },
  { kind: 'cylinder', name: 'Cylinder (database)' },
  { kind: 'document', name: 'Document' },
]

export const LINE_PRESETS: LinePreset[] = [
  { name: 'Line', dash: 'solid', startCap: 'none', endCap: 'none', routing: 'straight' },
  { name: 'Arrow', dash: 'solid', startCap: 'none', endCap: 'arrow', routing: 'straight' },
  { name: 'Double arrow', dash: 'solid', startCap: 'arrow', endCap: 'arrow', routing: 'straight' },
  { name: 'Dashed arrow', dash: 'dashed', startCap: 'none', endCap: 'triangle', routing: 'straight' },
  { name: 'Dotted line', dash: 'dotted', startCap: 'none', endCap: 'none', routing: 'straight' },
  { name: 'Elbow connector', dash: 'solid', startCap: 'none', endCap: 'triangle', routing: 'elbow' },
]

export const DEFAULT_STYLE: StyleDefaults = {
  stroke: '#1e1e1e',
  fill: '#ffffff',
  strokeWidth: 2,
  dash: 'solid',
  fontSize: 18,
}

export const DEFAULT_PEN: PenSettings = {
  color: '#1e1e1e',
  size: 4,
  highlighter: false,
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
