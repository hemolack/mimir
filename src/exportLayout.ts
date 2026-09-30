/** Pure layout helpers for exporting: text wrapping, PNG sizing, PDF page fitting. */

/**
 * Greedy word wrap matching the on-screen labels (pre-wrap + overflow-wrap:
 * anywhere): explicit newlines are kept, and words longer than a line are
 * broken between characters.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // The word alone may still be too wide: split it.
      line = ''
      for (const ch of word) {
        if (line && measure(line + ch) > maxWidth) {
          lines.push(line)
          line = ch
        } else {
          line += ch
        }
      }
    }
    lines.push(line)
  }
  return lines
}

/** Browsers cap canvas size; shrink the requested scale to stay within limits. */
export function clampRasterScale(width: number, height: number, scale: number): number {
  const MAX_SIDE = 16384
  const MAX_AREA = 268_000_000
  return Math.max(
    0.01,
    Math.min(scale, MAX_SIDE / Math.max(width, height, 1), Math.sqrt(MAX_AREA / Math.max(width * height, 1))),
  )
}

export type PageSize = 'fit' | 'a4' | 'letter'

const PAGES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}
/** CSS px → PDF points (96 dpi → 72 dpi). */
export const PX_TO_PT = 0.75
const MARGIN_PT = 36

/**
 * Page size and where the drawing goes on it, in points. 'fit' makes the page
 * the drawing's size; paper sizes turn to match the drawing's orientation and
 * scale it to fit within margins, centered.
 */
export function pdfLayout(widthPx: number, heightPx: number, page: PageSize) {
  const w = widthPx * PX_TO_PT
  const h = heightPx * PX_TO_PT
  if (page === 'fit') return { pageW: w, pageH: h, x: 0, y: 0, w, h }
  const [short, long] = PAGES[page]
  const landscape = w > h
  const pageW = landscape ? long : short
  const pageH = landscape ? short : long
  const s = Math.min((pageW - MARGIN_PT * 2) / w, (pageH - MARGIN_PT * 2) / h)
  return { pageW, pageH, x: (pageW - w * s) / 2, y: (pageH - h * s) / 2, w: w * s, h: h * s }
}

/** e.g. whiteboard-team-retro-2026-09-30.png */
export function exportFileName(boardId: string | null, ext: string, now = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `whiteboard${boardId ? `-${boardId}` : ''}-${date}.${ext}`
}
