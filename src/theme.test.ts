import { describe, expect, it } from 'vitest'
import { FILL_COLORS, STROKE_COLORS } from './constants'
import { CANVAS, contrast, darkFill, darkInk, paintFor } from './theme'

const hexes = (list: string[]) => list.filter((c) => c.startsWith('#'))

describe('dark theme colors', () => {
  it('flips black ink to near-white', () => {
    expect(contrast(darkInk('#1e1e1e'), '#ffffff')).toBeLessThan(1.4)
    expect(contrast(darkInk('#1e1e1e'), CANVAS.dark)).toBeGreaterThan(12)
  })

  it('keeps hue for colored ink but lightens it', () => {
    const red = darkInk('#e03131')
    expect(red).toMatch(/^#[0-9a-f]{6}$/)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('makes every palette ink color clearly visible on the dark canvas', () => {
    for (const c of hexes(STROKE_COLORS)) {
      expect(contrast(darkInk(c), CANVAS.dark), c).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('turns every light fill dark, keeping default (black) labels readable on it', () => {
    for (const c of hexes(FILL_COLORS)) {
      const fill = darkFill(c)
      expect(contrast(fill, '#ffffff'), c).toBeGreaterThan(4.5) // fill is dark now
      expect(contrast(darkInk('#1e1e1e'), fill), c).toBeGreaterThanOrEqual(7) // label ink on it
    }
  })

  it('keeps white fills distinguishable from the canvas', () => {
    expect(darkFill('#ffffff')).not.toBe(CANVAS.dark)
    expect(contrast(darkFill('#ffffff'), CANVAS.dark)).toBeGreaterThan(1.05)
  })

  it('leaves non-hex values such as "none" alone', () => {
    expect(darkFill('none')).toBe('none')
    expect(darkInk('transparent')).toBe('transparent')
  })

  it('changes nothing in the light theme', () => {
    const light = paintFor('light')
    expect(light.ink('#1e1e1e')).toBe('#1e1e1e')
    expect(light.fill('#a5d8ff')).toBe('#a5d8ff')
    expect(light.paper).toBe('#ffffff')
  })
})
