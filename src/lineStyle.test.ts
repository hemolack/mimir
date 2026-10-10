import { describe, expect, it } from 'vitest'
import { LINE_CAPS, LINE_DASHES } from './constants'
import { capInset, capPath, doubleRails, linePath, linePoints, offsetPolyline, roundedPath, toMap, trimPolyline } from './geometry'
import type { LineElement, ShapeElement } from './types'

describe('offsetPolyline (double-line rails)', () => {
  it('shifts a straight segment sideways', () => {
    const pts = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
    )
    expect(pts).toEqual([
      { x: 0, y: -2 },
      { x: 10, y: -2 },
    ])
  })

  it('keeps both rails the same distance from each leg at a right-angle corner', () => {
    const [, corner] = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      2,
    )
    // Rail runs 2 above the first leg and 2 right of the second.
    expect(corner.x).toBeCloseTo(12)
    expect(corner.y).toBeCloseTo(-2)
  })

  it('gives rails that are thinner than the line and clearly apart', () => {
    const { railWidth, offset } = doubleRails(4)
    expect(railWidth).toBeLessThan(4)
    expect(offset * 2 - railWidth).toBeGreaterThan(railWidth) // visible gap between rails
  })
})

describe('roundedPath (curved elbow)', () => {
  // Right, then down: one clockwise corner at (100, 0).
  const elbow = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]
  /** The point where the curve starts leaving the first leg. */
  const curveStart = (d: string) => d.match(/L(-?[\d.]+) (-?[\d.]+) Q/)!.slice(1).map(Number)

  it('rounds each corner with the given radius', () => {
    const d = roundedPath(elbow, 16)
    expect(d).toContain('Q100 0 100 16')
    expect(curveStart(d)).toEqual([84, 0])
  })

  it('shrinks the radius to fit short middle segments', () => {
    const zigzag = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 10 },
    ]
    // The 10px middle leg is shared by two corners, so each gets at most 5.
    expect(roundedPath(zigzag, 16)).toContain('Q50 0 50 5')
  })

  it('lets a corner use all of a short end segment', () => {
    const shortEnd = [
      { x: 90, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    expect(curveStart(roundedPath(shortEnd, 16))).toEqual([90, 0])
  })

  it('keeps double-line rails concentric: wider outside the turn, tighter inside', () => {
    // A clockwise turn's outside is the left (+offset) rail.
    expect(roundedPath(elbow, 16, 3)).toContain('Q100 0 100 19')
    expect(roundedPath(elbow, 16, -3)).toContain('Q100 0 100 13')
  })

  it('routes a curved elbow between shapes exactly like an elbow', () => {
    const box = (id: string, x: number, y: number): ShapeElement => ({
      id, type: 'shape', kind: 'rectangle', x, y, w: 40, h: 40, fill: 'none', stroke: '#000', strokeWidth: 2, dash: 'solid', label: '', fontSize: 18,
    })
    const line = (routing: LineElement['routing']): LineElement => ({
      id: 'l', type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, startBinding: 'a', endBinding: 'b',
      startCap: 'none', endCap: 'triangle', routing, stroke: '#000', strokeWidth: 2, dash: 'solid', label: '', fontSize: 18,
    })
    const map = toMap([box('a', 0, 0), box('b', 200, 150)])
    expect(linePoints(line('curved-elbow'), map)).toEqual(linePoints(line('elbow'), map))
    expect(linePoints(line('curved-elbow'), map)).toHaveLength(4)
  })

  it('draws curved elbows rounded and other routes as polylines', () => {
    expect(linePath(elbow, 'curved-elbow')).toContain('Q')
    expect(linePath(elbow, 'elbow')).not.toContain('Q')
    expect(linePath(elbow, 'straight')).toBe('M0 0 L100 0 L100 100')
  })
})

describe('trimPolyline / capInset', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]
  it('stops the line at the back of closed ends only', () => {
    expect(capInset('triangle-open', 2)).toBeGreaterThan(0)
    expect(capInset('diamond', 2)).toBeGreaterThan(capInset('triangle', 2))
    expect(capInset('arrow', 2)).toBe(0)
    expect(capInset('bar', 2)).toBe(0)
  })
  it('cuts both ends', () => {
    expect(trimPolyline(line, 10, 20)).toEqual([
      { x: 10, y: 0 },
      { x: 80, y: 0 },
    ])
  })
  it('cuts across corners', () => {
    const elbow = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 100 },
    ]
    expect(trimPolyline(elbow, 10, 0)[0]).toEqual({ x: 5, y: 5 })
  })
  it('never cuts a short line away entirely', () => {
    const t = trimPolyline(line, 80, 80)
    expect(t[1].x - t[0].x).toBeGreaterThan(0)
  })
})

describe('line ends', () => {
  const tip = { x: 100, y: 0 }
  const from = { x: 0, y: 0 }

  it('draws every listed end except "none"', () => {
    for (const { value } of LINE_CAPS) {
      const cap = capPath(value, tip, from, 2)
      if (value === 'none') expect(cap).toBeNull()
      else expect(cap?.d.length).toBeGreaterThan(0)
    }
  })

  it('fills solid ends with the line color and hollow ends with paper', () => {
    expect(capPath('triangle', tip, from, 2)?.fill).toBe('stroke')
    expect(capPath('triangle-open', tip, from, 2)?.fill).toBe('paper')
    expect(capPath('circle-open', tip, from, 2)?.fill).toBe('paper')
    expect(capPath('diamond-open', tip, from, 2)?.fill).toBe('paper')
    expect(capPath('arrow', tip, from, 2)?.fill).toBe('none')
    expect(capPath('bar', tip, from, 2)?.fill).toBe('none')
  })

  it('draws the bar across the line at the tip', () => {
    const d = capPath('bar', tip, from, 2)!.d
    const [x1, y1, x2, y2] = d.match(/-?[\d.]+/g)!.map(Number)
    expect(x1).toBeCloseTo(100)
    expect(x2).toBeCloseTo(100)
    expect(y1).toBeCloseTo(-y2)
  })

  it('offers the four line styles', () => {
    expect(LINE_DASHES.map((d) => d.value)).toEqual(['solid', 'dashed', 'dotted', 'double'])
  })
})
