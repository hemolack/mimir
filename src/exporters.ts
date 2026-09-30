import { FONT_FAMILY } from './constants'
import { clampRasterScale, exportFileName, pdfLayout, wrapText } from './exportLayout'
import type { PageSize } from './exportLayout'
import { getBounds, labelBox, linePoints, polylineMidpoint, toMap, unionRects } from './geometry'
import type { BoardElement, ElementMap, Rect } from './types'

const PAD = 24
const SVG_NS = 'http://www.w3.org/2000/svg'
/** PDF viewers only ship a few fonts; Helvetica maps to a built-in one. */
const PDF_FONT = 'Helvetica, Arial, sans-serif'

export type ExportFormat = 'png' | 'pdf' | 'svg'

export interface ExportOptions {
  format: ExportFormat
  /** Only these elements (null = the whole board). */
  ids: ReadonlySet<string> | null
  background: 'white' | 'transparent'
  /** PNG pixel density. */
  scale: number
  page: PageSize
  boardId: string | null
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Bounds of `elements`, resolving connector ends against `all` (they may attach to unlisted shapes). */
export function contentBounds(elements: BoardElement[], all: BoardElement[] = elements): Rect | null {
  const map = toMap(all)
  return unionRects(elements.map((el) => getBounds(el, map)))
}

// ---------- Building a self-contained SVG ----------

let measureCtx: CanvasRenderingContext2D | null = null
function measurer(fontSize: number, fontFamily: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const ctx = measureCtx!
  ctx.font = `${fontSize}px ${fontFamily}`
  return (s: string) => ctx.measureText(s).width
}

const labelColor = (stroke: string) => (stroke === 'none' || stroke === 'transparent' ? '#1e1e1e' : stroke)

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

/** Centered multi-line SVG text inside `box` (what the on-screen HTML label looks like). */
function textBlock(lines: string[], box: Rect, fontSize: number, color: string, fontFamily: string): SVGTextElement {
  const lineHeight = fontSize * 1.25
  const top = box.y + (box.h - lines.length * lineHeight) / 2
  const text = svgEl('text', {
    'font-size': fontSize,
    'font-family': fontFamily,
    fill: color,
    'text-anchor': 'middle',
  })
  lines.forEach((line, i) => {
    const tspan = svgEl('tspan', {
      x: box.x + box.w / 2,
      // Baseline: centre the glyphs (≈0.8em ascent) within each line box.
      y: top + i * lineHeight + (lineHeight - fontSize) / 2 + fontSize * 0.8,
    })
    tspan.textContent = line || ' '
    text.appendChild(tspan)
  })
  return text
}

/** SVG replacement for an element's HTML label, in the element group's own coordinates. */
function labelFor(el: BoardElement, map: ElementMap, fontFamily: string): SVGElement | null {
  if ((el.type !== 'shape' && el.type !== 'line') || !el.label) return null
  const measure = measurer(el.fontSize, fontFamily)
  const color = labelColor(el.stroke)

  if (el.type === 'shape') {
    const b = labelBox(el.kind, el.w, el.h)
    const inner = { x: b.x + 4, y: b.y + 4, w: Math.max(b.w - 8, 1), h: Math.max(b.h - 8, 1) }
    return textBlock(wrapText(el.label, inner.w, measure), inner, el.fontSize, color, fontFamily)
  }

  // Line label: a white tag centred on the line's midpoint.
  const mid = polylineMidpoint(linePoints(el, map))
  const lines = wrapText(el.label, 288, measure)
  const w = Math.max(...lines.map(measure)) + 12
  const h = lines.length * el.fontSize * 1.25 + 2
  const box = { x: mid.x - w / 2, y: mid.y - h / 2, w, h }
  const g = svgEl('g', {})
  g.appendChild(svgEl('rect', { x: box.x, y: box.y, width: w, height: h, rx: 4, fill: '#ffffff' }))
  g.appendChild(textBlock(lines, box, el.fontSize, color, fontFamily))
  return g
}

const isInvisible = (v: string | null) => v === 'none' || v === 'transparent'

/**
 * A standalone SVG of the board (or some elements), cropped to the content.
 * It is cloned from what's on screen, then made portable: HTML labels become
 * wrapped SVG text and the invisible hit-areas used for clicking are dropped.
 */
export function buildExportSvg(
  svg: SVGSVGElement,
  elements: BoardElement[],
  opts: { ids: ReadonlySet<string> | null; background: 'white' | 'transparent'; fontFamily: string },
): { svg: SVGSVGElement; width: number; height: number } | null {
  const layer = svg.querySelector('[data-layer="content"]')
  const chosen = opts.ids ? elements.filter((el) => opts.ids!.has(el.id)) : elements
  const b = contentBounds(chosen, elements)
  if (!layer || !b) return null

  const x = b.x - PAD
  const y = b.y - PAD
  const width = Math.ceil(b.w + PAD * 2)
  const height = Math.ceil(b.h + PAD * 2)
  const out = svgEl('svg', { xmlns: SVG_NS, viewBox: `${x} ${y} ${width} ${height}`, width, height })
  if (opts.background === 'white') out.appendChild(svgEl('rect', { x, y, width, height, fill: '#ffffff' }))

  const map = toMap(elements)
  const clone = layer.cloneNode(true) as SVGGElement
  clone.removeAttribute('data-layer')
  for (const node of [...clone.children]) {
    const el = map.get(node.getAttribute('data-id') ?? '')
    if (!el || (opts.ids && !opts.ids.has(el.id))) {
      node.remove()
      continue
    }
    node.querySelectorAll('foreignObject').forEach((fo) => fo.remove())
    const label = labelFor(el, map, opts.fontFamily)
    if (label) node.appendChild(label)
  }
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    if (node.getAttribute('stroke') === 'transparent') node.setAttribute('stroke', 'none')
    if (node.getAttribute('fill') === 'transparent') node.setAttribute('fill', 'none')
    node.removeAttribute('pointer-events')
    node.removeAttribute('data-id')
    // Click targets: paths drawn with neither fill nor stroke.
    if (node.tagName === 'path' && isInvisible(node.getAttribute('fill')) && isInvisible(node.getAttribute('stroke'))) {
      node.remove()
    }
  }
  out.appendChild(clone)
  return { svg: out, width, height }
}

// ---------- Formats ----------

async function toPng(built: { svg: SVGSVGElement; width: number; height: number }, scale: number): Promise<Blob> {
  const markup = new XMLSerializer().serializeToString(built.svg)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const s = clampRasterScale(built.width, built.height, scale)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(built.width * s)
    canvas.height = Math.round(built.height * s)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('The browser could not create the PNG.')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function toPdf(built: { svg: SVGSVGElement; width: number; height: number }, page: PageSize): Promise<Blob> {
  // Loaded on demand: the PDF libraries are large and only needed here.
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const l = pdfLayout(built.width, built.height, page)
  const doc = new jsPDF({ unit: 'pt', format: [l.pageW, l.pageH], orientation: l.pageW > l.pageH ? 'landscape' : 'portrait' })
  // svg2pdf reads computed styles, so the SVG must be in the document while converting.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden'
  host.appendChild(built.svg)
  document.body.appendChild(host)
  try {
    await svg2pdf(built.svg, doc, { x: l.x, y: l.y, width: l.w, height: l.h })
  } finally {
    host.remove()
  }
  return doc.output('blob')
}

/** Export the board. Returns false when there is nothing to export. */
export async function exportBoard(svg: SVGSVGElement, elements: BoardElement[], opts: ExportOptions): Promise<boolean> {
  const built = buildExportSvg(svg, elements, {
    ids: opts.ids,
    // A PDF page is already white; a transparent PNG/SVG is a choice.
    background: opts.format === 'pdf' ? 'transparent' : opts.background,
    fontFamily: opts.format === 'pdf' ? PDF_FONT : FONT_FAMILY,
  })
  if (!built) return false
  const name = exportFileName(opts.boardId, opts.format)
  if (opts.format === 'svg') {
    download(new Blob([new XMLSerializer().serializeToString(built.svg)], { type: 'image/svg+xml' }), name)
  } else if (opts.format === 'png') {
    download(await toPng(built, opts.scale), name)
  } else {
    download(await toPdf(built, opts.page), name)
  }
  return true
}

/** Pixel size of a PNG export, for showing in the dialog. */
export function pngSize(elements: BoardElement[], ids: ReadonlySet<string> | null, scale: number) {
  const chosen = ids ? elements.filter((el) => ids.has(el.id)) : elements
  const b = contentBounds(chosen, elements)
  if (!b) return null
  const w = Math.ceil(b.w + PAD * 2)
  const h = Math.ceil(b.h + PAD * 2)
  const s = clampRasterScale(w, h, scale)
  return { width: Math.round(w * s), height: Math.round(h * s), clamped: s < scale }
}

export function saveBoardFile(elements: BoardElement[]) {
  const json = JSON.stringify({ app: 'whiteboard', version: 1, elements }, null, 2)
  download(new Blob([json], { type: 'application/json' }), 'whiteboard.json')
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}
