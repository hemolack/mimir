import type { Cap, DashStyle, LineStyle, PenSettings, Routing, ShapeKind, StyleDefaults } from './types.ts'

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

/** Names for the palette colors (tooltips and screen readers). */
export const COLOR_NAMES: Record<string, string> = {
  '#1e1e1e': 'Black',
  '#e03131': 'Red',
  '#f08c00': 'Orange',
  '#2f9e44': 'Green',
  '#1971c2': 'Blue',
  '#0c8599': 'Teal',
  '#9c36b5': 'Purple',
  '#868e96': 'Gray',
}

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

export const LINE_DASHES: { value: DashStyle; name: string }[] = [
  { value: 'solid', name: 'Solid' },
  { value: 'dashed', name: 'Dashed' },
  { value: 'dotted', name: 'Dotted' },
  { value: 'double', name: 'Double' },
]

export const LINE_CAPS: { value: Cap; name: string }[] = [
  { value: 'none', name: 'None' },
  { value: 'arrow', name: 'Arrow' },
  { value: 'triangle', name: 'Solid triangle' },
  { value: 'triangle-open', name: 'Hollow triangle' },
  { value: 'circle', name: 'Solid circle' },
  { value: 'circle-open', name: 'Hollow circle' },
  { value: 'diamond', name: 'Solid diamond' },
  { value: 'diamond-open', name: 'Hollow diamond' },
  { value: 'bar', name: 'Bar' },
]

export const LINE_ROUTES: { value: Routing; name: string }[] = [
  { value: 'straight', name: 'Straight' },
  { value: 'elbow', name: 'Elbow' },
  { value: 'curved-elbow', name: 'Curved elbow' },
]

export const DEFAULT_LINE: LineStyle = { dash: 'solid', startCap: 'none', endCap: 'triangle', routing: 'straight' }

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
