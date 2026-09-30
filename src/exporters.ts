import { getBounds, toMap, unionRects } from './geometry'
import type { BoardElement, Rect } from './types'

const PAD = 24

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

export function contentBounds(elements: BoardElement[]): Rect | null {
  const map = toMap(elements)
  return unionRects(elements.map((el) => getBounds(el, map)))
}

function buildSvg(svg: SVGSVGElement, elements: BoardElement[]): { markup: string; w: number; h: number } | null {
  const content = svg.querySelector('[data-layer="content"]')
  const b = contentBounds(elements)
  if (!content || !b) return null
  const x = b.x - PAD
  const y = b.y - PAD
  const w = Math.ceil(b.w + PAD * 2)
  const h = Math.ceil(b.h + PAD * 2)
  const inner = new XMLSerializer().serializeToString(content)
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${inner}</svg>`
  return { markup, w, h }
}

export function exportSvg(svg: SVGSVGElement, elements: BoardElement[]): boolean {
  const built = buildSvg(svg, elements)
  if (!built) return false
  download(new Blob([built.markup], { type: 'image/svg+xml' }), 'whiteboard.svg')
  return true
}

export async function exportPng(svg: SVGSVGElement, elements: BoardElement[], scale = 2): Promise<boolean> {
  const built = buildSvg(svg, elements)
  if (!built) return false
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.markup)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = built.w * scale
  canvas.height = built.h * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  // Some browsers taint canvases that drew SVG text via foreignObject; toBlob then throws.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return false
  download(blob, 'whiteboard.png')
  return true
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
