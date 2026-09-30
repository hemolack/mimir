import { DEFAULT_LINE, DEFAULT_PEN, DEFAULT_STYLE } from './constants.ts'
import type { BoardElement, LineStyle, PenSettings, StyleDefaults, Viewport } from './types.ts'

const BOARD_KEY = 'whiteboard.board.v1'
const SETTINGS_KEY = 'whiteboard.settings.v1'

export interface SavedBoard {
  elements: BoardElement[]
  viewport: Viewport
}

export interface SavedSettings {
  style: StyleDefaults
  pen: PenSettings
  line: LineStyle
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPoint = (v: unknown) => isObj(v) && isNum(v.x) && isNum(v.y)

/** Keep only well-formed elements from untrusted input (storage or an opened file). */
export function sanitizeElements(raw: unknown): BoardElement[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.filter((el): el is BoardElement => {
    if (!isObj(el) || typeof el.id !== 'string' || seen.has(el.id)) return false
    seen.add(el.id)
    switch (el.type) {
      case 'shape':
        return typeof el.kind === 'string' && [el.x, el.y, el.w, el.h, el.strokeWidth, el.fontSize].every(isNum)
      case 'line':
        return isPoint(el.start) && isPoint(el.end) && isNum(el.strokeWidth) && isNum(el.fontSize)
      case 'path':
        return (
          Array.isArray(el.points) &&
          el.points.every((p) => Array.isArray(p) && p.length >= 2 && p.every(isNum)) &&
          isNum(el.size)
        )
      case 'curve':
        return (
          Array.isArray(el.points) &&
          el.points.length >= 4 &&
          (el.points.length - 1) % 3 === 0 &&
          el.points.every(isPoint) &&
          isNum(el.strokeWidth)
        )
      default:
        return false
    }
  })
}

function sanitizeViewport(raw: unknown): Viewport {
  if (isObj(raw) && isNum(raw.x) && isNum(raw.y) && isNum(raw.zoom) && raw.zoom > 0) {
    return { x: raw.x, y: raw.y, zoom: raw.zoom }
  }
  return { x: 0, y: 0, zoom: 1 }
}

function read(key: string): unknown {
  try {
    const text = localStorage.getItem(key)
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Quota exceeded or storage unavailable (e.g. private mode).
    return false
  }
}

export function loadBoard(): SavedBoard {
  const raw = read(BOARD_KEY)
  return {
    elements: sanitizeElements(isObj(raw) ? raw.elements : null),
    viewport: sanitizeViewport(isObj(raw) ? raw.viewport : null),
  }
}

export function saveBoard(board: SavedBoard): boolean {
  return write(BOARD_KEY, { version: 1, ...board })
}

export function loadSettings(): SavedSettings {
  const raw = read(SETTINGS_KEY)
  const style = isObj(raw) && isObj(raw.style) ? raw.style : {}
  const pen = isObj(raw) && isObj(raw.pen) ? raw.pen : {}
  const line = isObj(raw) && isObj(raw.line) ? raw.line : {}
  return {
    style: { ...DEFAULT_STYLE, ...(style as Partial<StyleDefaults>) },
    pen: { ...DEFAULT_PEN, ...(pen as Partial<PenSettings>) },
    line: { ...DEFAULT_LINE, ...(line as Partial<LineStyle>) },
  }
}

export function saveSettings(settings: SavedSettings): void {
  write(SETTINGS_KEY, settings)
}

/** Parse a board file saved with "Save to file". */
export function parseBoardFile(text: string): BoardElement[] | null {
  try {
    const raw: unknown = JSON.parse(text)
    const list = isObj(raw) ? raw.elements : raw
    return Array.isArray(list) ? sanitizeElements(list) : null
  } catch {
    return null
  }
}
