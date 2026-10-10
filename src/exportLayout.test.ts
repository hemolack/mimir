import { describe, expect, it } from 'vitest'
import { clampRasterScale, exportFileName, pdfLayout, PX_TO_PT, wrapText } from './exportLayout'

// Monospace stand-in: every character is 10 units wide.
const measure = (s: string) => s.length * 10

describe('wrapText', () => {
  it('fills lines greedily by word', () => {
    expect(wrapText('the quick brown fox', 100, measure)).toEqual(['the quick', 'brown fox'])
  })
  it('keeps explicit line breaks and blank lines', () => {
    expect(wrapText('a\n\nb', 100, measure)).toEqual(['a', '', 'b'])
  })
  it('breaks words that are longer than a line', () => {
    expect(wrapText('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij'])
  })
  it('continues after a broken word', () => {
    expect(wrapText('go abcdefgh ok', 40, measure)).toEqual(['go', 'abcd', 'efgh', 'ok'])
  })
})

describe('clampRasterScale', () => {
  it('keeps the requested scale when it fits', () => {
    expect(clampRasterScale(1000, 800, 3)).toBe(3)
  })
  it('shrinks to the maximum canvas side', () => {
    expect(clampRasterScale(10000, 100, 3)).toBeCloseTo(1.6384)
  })
  it('shrinks to the maximum canvas area', () => {
    const s = clampRasterScale(12000, 12000, 2)
    expect(12000 * s * 12000 * s).toBeLessThanOrEqual(268_000_000 + 1)
  })
})

describe('pdfLayout', () => {
  it('sizes the page to the drawing for "fit"', () => {
    expect(pdfLayout(400, 200, 'fit')).toEqual({ pageW: 300, pageH: 150, x: 0, y: 0, w: 300, h: 150 })
  })
  it('turns A4 to landscape for wide drawings and centers within margins', () => {
    const l = pdfLayout(2000, 1000, 'a4')
    expect(l.pageW).toBeCloseTo(841.89)
    expect(l.pageH).toBeCloseTo(595.28)
    expect(l.w / l.h).toBeCloseTo(2)
    expect(l.x).toBeCloseTo(36)
    expect(l.y).toBeCloseTo((l.pageH - l.h) / 2)
  })
  it('scales small drawings up to fill a Letter page', () => {
    const l = pdfLayout(100, 200, 'letter')
    expect([l.pageW, l.pageH]).toEqual([612, 792])
    expect(l.h).toBeCloseTo(792 - 72)
    expect(l.w).toBeGreaterThan(100 * PX_TO_PT)
  })
})

describe('exportFileName', () => {
  const day = new Date(2026, 8, 30)
  it('includes the shared board id and date', () => {
    expect(exportFileName('team-retro', 'pdf', day)).toBe('whiteboard-team-retro-2026-09-30.pdf')
  })
  it('omits the id for the private board', () => {
    expect(exportFileName(null, 'png', day)).toBe('whiteboard-2026-09-30.png')
  })
})
