export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Tool =
  | 'select'
  | 'hand'
  | 'move'
  | 'scale'
  | 'rotate'
  | 'pen'
  | 'curve'
  | 'eraser'
  | 'text'
  | 'shape'
  | 'line'

export type ShapeKind =
  | 'rectangle'
  | 'rounded'
  | 'square'
  | 'circle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'parallelogram'
  | 'hexagon'
  | 'cylinder'
  | 'document'
  | 'text'

export type DashStyle = 'solid' | 'dashed' | 'dotted'
export type Cap = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond'
export type Routing = 'straight' | 'elbow'

interface Labeled {
  id: string
  stroke: string
  strokeWidth: number
  dash: DashStyle
  label: string
  fontSize: number
}

export interface ShapeElement extends Labeled {
  type: 'shape'
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  fill: string
  /** Radians, clockwise, around the shape's center. */
  rotation?: number
  /** Mirror the outline (not the label) within the shape's own frame. */
  flipX?: boolean
  flipY?: boolean
}

export interface LineElement extends Labeled {
  type: 'line'
  /** Free endpoint positions; ignored while the end is bound to a shape. */
  start: Point
  end: Point
  startBinding: string | null
  endBinding: string | null
  startCap: Cap
  endCap: Cap
  routing: Routing
}

export interface PathElement {
  id: string
  type: 'path'
  /** [x, y, pressure] triples in world coordinates. */
  points: number[][]
  stroke: string
  size: number
  opacity: number
  highlighter: boolean
  simulatePressure: boolean
}

/** Freehand stroke fitted to a chain of cubic Béziers. */
export interface CurveElement {
  id: string
  type: 'curve'
  /** Anchors and controls: [p0, c1, c2, p1, c1, c2, p2, ...] (length 3n + 1). */
  points: Point[]
  closed: boolean
  stroke: string
  strokeWidth: number
  dash: DashStyle
  fill: string
}

export type BoardElement = ShapeElement | LineElement | PathElement | CurveElement
export type ElementMap = Map<string, BoardElement>

/** screen = world * zoom + (x, y) */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface StyleDefaults {
  stroke: string
  fill: string
  strokeWidth: number
  dash: DashStyle
  fontSize: number
}

export interface LinePreset {
  name: string
  dash: DashStyle
  startCap: Cap
  endCap: Cap
  routing: Routing
}

export interface PenSettings {
  color: string
  size: number
  highlighter: boolean
}
