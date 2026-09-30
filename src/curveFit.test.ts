import { describe, expect, it } from 'vitest'
import { bezierPath, fitStroke, resample, strokeToCurve } from './curveFit'
import { sanitizeElements } from './storage'
import type { Point } from './types'

const opts = { tolerance: 4, spacing: 4 }

/** Sample every fitted segment densely and return all points. */
function sampleFitted(points: Point[]): Point[] {
  const out: Point[] = []
  for (let i = 0; i + 3 < points.length; i += 3) {
    const [p0, c1, c2, p3] = points.slice(i, i + 4)
    for (let s = 0; s <= 50; s++) {
      const t = s / 50
      const mt = 1 - t
      out.push({
        x: mt ** 3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * p3.x,
        y: mt ** 3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * p3.y,
      })
    }
  }
  return out
}

/** Largest distance from any input point to the fitted curve. */
function maxDeviation(input: Point[], fitted: Point[]): number {
  const samples = sampleFitted(fitted)
  return Math.max(...input.map((p) => Math.min(...samples.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))))
}

const segments = (fitted: Point[]) => (fitted.length - 1) / 3

// A wavy stroke with a little hand jitter.
const wave: Point[] = Array.from({ length: 200 }, (_, i) => ({
  x: i * 2,
  y: Math.sin(i / 20) * 60 + Math.sin(i * 1.7) * 0.8,
}))

describe('fitStroke', () => {
  it('fits a smooth stroke with few segments within tolerance', () => {
    const fitted = fitStroke(wave, opts)
    expect((fitted.length - 1) % 3).toBe(0)
    expect(segments(fitted)).toBeLessThanOrEqual(8)
    expect(maxDeviation(wave, fitted)).toBeLessThan(opts.tolerance * 1.5)
  })

  it('keeps the exact start and end points', () => {
    const fitted = fitStroke(wave, opts)
    expect(fitted[0]).toEqual(wave[0])
    expect(fitted[fitted.length - 1]).toEqual(wave[wave.length - 1])
  })

  it('uses a single segment for a straight stroke', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 3, y: i * 1.5 }))
    expect(segments(fitStroke(line, opts))).toBe(1)
  })

  it('preserves sharp corners', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]
    const square: Point[] = []
    for (let s = 0; s < 3; s++) {
      const a = corners[s]
      const b = corners[s + 1]
      for (let i = 0; i < 50; i++) square.push({ x: a.x + ((b.x - a.x) * i) / 50, y: a.y + ((b.y - a.y) * i) / 50 })
    }
    square.push(corners[3])
    const fitted = fitStroke(square, opts)
    const anchors = fitted.filter((_, i) => i % 3 === 0)
    for (const c of corners) {
      expect(Math.min(...anchors.map((a) => Math.hypot(a.x - c.x, a.y - c.y)))).toBeLessThan(10)
    }
    expect(maxDeviation(square, fitted)).toBeLessThan(opts.tolerance * 1.5)
  })
})

describe('resample', () => {
  it('spaces points evenly and keeps the last point', () => {
    const out = resample(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
    )
    expect(out.map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10])
  })
})

describe('strokeToCurve', () => {
  it('closes a stroke that returns to its start', () => {
    const circle = Array.from({ length: 90 }, (_, i) => ({
      x: Math.cos((i / 90) * Math.PI * 2) * 80,
      y: Math.sin((i / 90) * Math.PI * 2) * 80,
    }))
    const result = strokeToCurve(circle, 1)!
    expect(result.closed).toBe(true)
    expect(result.points[result.points.length - 1]).toEqual(result.points[0])
    expect(bezierPath(result.points, true).endsWith('Z')).toBe(true)
  })

  it('leaves open strokes open', () => {
    expect(strokeToCurve(wave, 1)!.closed).toBe(false)
  })

  it('ignores taps', () => {
    expect(strokeToCurve([{ x: 5, y: 5 }, { x: 5.5, y: 5 }], 1)).toBeNull()
  })

  it('scales tolerance with zoom', () => {
    const zoomedOut = strokeToCurve(wave, 0.25)!
    const zoomedIn = strokeToCurve(wave, 4)!
    expect(segments(zoomedOut.points)).toBeLessThanOrEqual(segments(zoomedIn.points))
  })
})

describe('curve storage', () => {
  it('accepts well-formed curves and rejects bad point counts', () => {
    const base = { type: 'curve', closed: false, stroke: '#000', strokeWidth: 2, dash: 'solid', fill: 'none' }
    const p = { x: 0, y: 0 }
    const out = sanitizeElements([
      { ...base, id: 'ok', points: [p, p, p, p] },
      { ...base, id: 'bad', points: [p, p, p] },
    ])
    expect(out.map((el) => el.id)).toEqual(['ok'])
  })
})
