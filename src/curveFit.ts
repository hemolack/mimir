import type { Point } from './types'

/**
 * Fit a freehand stroke with a chain of cubic Béziers.
 *
 * Pipeline: resample to even spacing → split at sharp corners → fit each run
 * with Philip Schneider's least-squares algorithm ("An Algorithm for
 * Automatically Fitting Digitized Curves", Graphics Gems, 1990).
 *
 * Returns [p0, c1, c2, p1, c1, c2, p2, ...] — 3n + 1 points for n segments.
 */
export function fitStroke(
  input: Point[],
  opts: { tolerance: number; spacing: number; cornerAngle?: number },
): Point[] {
  const pts = resample(input, opts.spacing)
  if (pts.length === 0) return []
  if (pts.length === 1) return [pts[0], pts[0], pts[0], pts[0]]

  const corners = findCorners(pts, ((opts.cornerAngle ?? 60) * Math.PI) / 180)
  const out: Point[] = [pts[0]]
  const errSq = opts.tolerance * opts.tolerance
  for (let i = 0; i < corners.length - 1; i++) {
    const run = pts.slice(corners[i], corners[i + 1] + 1)
    for (const bez of fitRun(run, errSq)) out.push(bez[1], bez[2], bez[3])
  }
  return out
}

/**
 * Turn a raw stroke (world coordinates) into a fitted curve. Tolerances are in
 * screen pixels so a stroke looks equally smooth at any zoom. A stroke that ends
 * near where it started becomes a closed (fillable) curve. Returns null for taps.
 */
export function strokeToCurve(raw: Point[], zoom: number): { points: Point[]; closed: boolean } | null {
  if (raw.length < 2) return null
  const xs = raw.map((p) => p.x)
  const ys = raw.map((p) => p.y)
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (diag < 3 / zoom) return null
  const gap = dist(raw[0], raw[raw.length - 1])
  const closed = raw.length > 8 && diag > 24 / zoom && gap < Math.max(16 / zoom, diag * 0.1)
  const points = fitStroke(closed ? [...raw, raw[0]] : raw, { tolerance: 4 / zoom, spacing: 4 / zoom })
  if (closed) points[points.length - 1] = points[0]
  return { points, closed }
}

/** SVG path data for a fitted point list. */
export function bezierPath(points: Point[], closed: boolean): string {
  if (points.length === 0) return ''
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i + 2 < points.length; i += 3) {
    const [c1, c2, p] = [points[i], points[i + 1], points[i + 2]]
    d += ` C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`
  }
  return closed ? d + ' Z' : d
}

// ---------- vector helpers ----------

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const normalize = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y)
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

// ---------- preprocessing ----------

/** Evenly spaced points along the polyline, keeping both ends. */
export function resample(points: Point[], spacing: number): Point[] {
  if (points.length === 0) return []
  const out: Point[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1]
    const b = points[i]
    let seg = dist(a, b)
    while (carry + seg >= spacing) {
      const t = (spacing - carry) / seg
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      out.push(a)
      seg = dist(a, b)
      carry = 0
    }
    carry += seg
  }
  const last = points[points.length - 1]
  if (dist(out[out.length - 1], last) > spacing * 0.25) out.push(last)
  else out[out.length - 1] = last
  return out
}

/** Indices where the stroke turns sharply; always includes both ends. */
function findCorners(pts: Point[], minAngle: number): number[] {
  const k = 3
  const angles = pts.map((p, i) => {
    if (i < k || i >= pts.length - k) return 0
    const v1 = normalize(sub(p, pts[i - k]))
    const v2 = normalize(sub(pts[i + k], p))
    return Math.acos(Math.max(-1, Math.min(1, dot(v1, v2))))
  })
  const corners = [0]
  for (let i = k; i < pts.length - k; i++) {
    if (angles[i] < minAngle) continue
    // Keep only the sharpest point in each neighborhood.
    let isPeak = true
    for (let j = i - k; j <= i + k; j++) {
      if (angles[j] > angles[i] || (angles[j] === angles[i] && j < i)) isPeak = false
    }
    if (isPeak && i - corners[corners.length - 1] >= 2) corners.push(i)
  }
  if (pts.length - 1 - corners[corners.length - 1] < 2 && corners.length > 1) corners.pop()
  corners.push(pts.length - 1)
  return corners
}

// ---------- Schneider fitting ----------

type Bez = [Point, Point, Point, Point]

function fitRun(d: Point[], errSq: number): Bez[] {
  if (d.length === 2) return [lineBez(d[0], d[1])]
  const t1 = normalize(sub(d[Math.min(2, d.length - 1)], d[0]))
  const t2 = normalize(sub(d[Math.max(d.length - 3, 0)], d[d.length - 1]))
  return fitCubic(d, 0, d.length - 1, t1, t2, errSq, 0)
}

function lineBez(a: Point, b: Point): Bez {
  const v = sub(b, a)
  return [a, add(a, scale(v, 1 / 3)), add(a, scale(v, 2 / 3)), b]
}

function fitCubic(d: Point[], first: number, last: number, t1: Point, t2: Point, errSq: number, depth: number): Bez[] {
  if (last - first === 1) {
    const l = dist(d[first], d[last]) / 3
    return [[d[first], add(d[first], scale(t1, l)), add(d[last], scale(t2, l)), d[last]]]
  }

  let u = chordParams(d, first, last)
  let bez = generateBezier(d, first, last, u, t1, t2)
  let [maxErr, split] = maxError(d, first, last, bez, u)
  if (maxErr < errSq) return [bez]

  // Close enough: try improving the parameterization before splitting.
  if (maxErr < errSq * 4) {
    for (let i = 0; i < 20; i++) {
      const uPrime = reparameterize(d, first, u, bez)
      bez = generateBezier(d, first, last, uPrime, t1, t2)
      ;[maxErr, split] = maxError(d, first, last, bez, uPrime)
      if (maxErr < errSq) return [bez]
      u = uPrime
    }
  }
  if (depth > 16) return [bez]

  let center = normalize(sub(d[split - 1], d[split + 1]))
  if (center.x === 0 && center.y === 0) center = normalize(sub(d[split - 1], d[split]))
  return [
    ...fitCubic(d, first, split, t1, center, errSq, depth + 1),
    ...fitCubic(d, split, last, scale(center, -1), t2, errSq, depth + 1),
  ]
}

function chordParams(d: Point[], first: number, last: number): number[] {
  const u = [0]
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + dist(d[i], d[i - 1]))
  const total = u[u.length - 1] || 1
  return u.map((x) => x / total)
}

function generateBezier(d: Point[], first: number, last: number, u: number[], t1: Point, t2: Point): Bez {
  const p0 = d[first]
  const p3 = d[last]
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0
  for (let i = 0; i < u.length; i++) {
    const t = u[i]
    const mt = 1 - t
    const b0 = mt * mt * mt
    const b1 = 3 * t * mt * mt
    const b2 = 3 * t * t * mt
    const b3 = t * t * t
    const a0 = scale(t1, b1)
    const a1 = scale(t2, b2)
    c00 += dot(a0, a0)
    c01 += dot(a0, a1)
    c11 += dot(a1, a1)
    const tmp = sub(d[first + i], add(scale(p0, b0 + b1), scale(p3, b2 + b3)))
    x0 += dot(a0, tmp)
    x1 += dot(a1, tmp)
  }
  const det = c00 * c11 - c01 * c01
  let alphaL = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det
  let alphaR = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det

  // Degenerate or wildly overshooting solutions fall back to the Wu/Barsky heuristic.
  const segLen = dist(p0, p3)
  const eps = 1e-6 * segLen
  if (alphaL < eps || alphaR < eps || alphaL > segLen * 2 || alphaR > segLen * 2) {
    alphaL = alphaR = segLen / 3
  }
  return [p0, add(p0, scale(t1, alphaL)), add(p3, scale(t2, alphaR)), p3]
}

function bezierAt(b: Bez, t: number): Point {
  const mt = 1 - t
  const w0 = mt * mt * mt
  const w1 = 3 * mt * mt * t
  const w2 = 3 * mt * t * t
  const w3 = t * t * t
  return {
    x: b[0].x * w0 + b[1].x * w1 + b[2].x * w2 + b[3].x * w3,
    y: b[0].y * w0 + b[1].y * w1 + b[2].y * w2 + b[3].y * w3,
  }
}

function maxError(d: Point[], first: number, last: number, bez: Bez, u: number[]): [number, number] {
  let max = 0
  let split = Math.floor((first + last) / 2)
  for (let i = first + 1; i < last; i++) {
    const p = bezierAt(bez, u[i - first])
    const e = (p.x - d[i].x) ** 2 + (p.y - d[i].y) ** 2
    if (e >= max) {
      max = e
      split = i
    }
  }
  return [max, split]
}

/** One Newton-Raphson step per point toward its closest parameter on the curve. */
function reparameterize(d: Point[], first: number, u: number[], bez: Bez): number[] {
  const q1: Point[] = [0, 1, 2].map((i) => scale(sub(bez[i + 1], bez[i]), 3))
  const q2: Point[] = [0, 1].map((i) => scale(sub(q1[i + 1], q1[i]), 2))
  return u.map((t, i) => {
    const p = d[first + i]
    const q = bezierAt(bez, t)
    const mt = 1 - t
    const d1 = add(add(scale(q1[0], mt * mt), scale(q1[1], 2 * mt * t)), scale(q1[2], t * t))
    const d2 = add(scale(q2[0], mt), scale(q2[1], t))
    const diff = sub(q, p)
    const den = dot(d1, d1) + dot(diff, d2)
    if (den === 0) return t
    return Math.min(1, Math.max(0, t - dot(diff, d1) / den))
  })
}
