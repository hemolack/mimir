import { createContext, useContext, useEffect, useState } from 'react'

/**
 * Light/dark display themes. Elements always store their light-mode colors;
 * the dark theme maps them at render time, so collaborators, saved boards and
 * exports are unaffected by anyone's theme.
 */
export type Theme = 'light' | 'dark'
export type ThemeSetting = 'system' | Theme

/** The board's background (and what hollow arrowheads / label tags are filled with). */
export const CANVAS: Record<Theme, string> = { light: '#f8f9fa', dark: '#1f2023' }
/** Fill for "paper" parts: hollow caps and line-label tags. */
export const PAPER: Record<Theme, string> = { light: '#ffffff', dark: '#1f2023' }

// ---------- color math ----------

interface Hsl {
  h: number
  s: number
  l: number
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return { h, s, l }
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Lines, text and brush strokes on a dark canvas: neutrals flip (black → near
 * white, grays mirrored), saturated colors keep their hue but get light enough
 * to stand out.
 */
export function darkInk(color: string): string {
  const rgb = parseHex(color)
  if (!rgb) return color
  const { h, s, l } = rgbToHsl(rgb)
  if (s < 0.18) return hslToHex({ h, s, l: clamp(1 - l, 0.6, 0.9) })
  return hslToHex({ h, s: Math.min(s, 0.85), l: Math.max(l, 0.66) })
}

/**
 * Shape fills on a dark canvas: lightness is inverted into a dark band (white
 * → just above the canvas, pastels → deep muted versions of the same hue), so
 * labels in light ink stay readable on them.
 */
export function darkFill(color: string): string {
  const rgb = parseHex(color)
  if (!rgb) return color
  const { h, s, l } = rgbToHsl(rgb)
  const target = { h, s: s * 0.55, l: 0.15 + (1 - l) * 0.8 }
  // Some hues (yellow especially) stay bright at the same lightness; darken
  // further until default label ink reads comfortably on the fill.
  const labelInk = darkInk('#1e1e1e')
  while (target.l > 0.1 && contrast(labelInk, hslToHex(target)) < FILL_LABEL_CONTRAST) target.l -= 0.01
  return hslToHex(target)
}

/** Minimum contrast between default label text and a dark-theme fill (WCAG AAA for text). */
const FILL_LABEL_CONTRAST = 7

/** WCAG relative luminance of a hex color (for contrast checks). */
export function luminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------- React plumbing ----------

export interface Paint {
  theme: Theme
  /** Color for strokes, text and brush marks. */
  ink(color: string): string
  /** Color for shape fills. */
  fill(color: string): string
  /** Fill for hollow caps and line-label tags. */
  paper: string
  canvas: string
}

export function paintFor(theme: Theme): Paint {
  const dark = theme === 'dark'
  return {
    theme,
    ink: (c) => (dark ? darkInk(c) : c),
    fill: (c) => (dark ? darkFill(c) : c),
    paper: PAPER[theme],
    canvas: CANVAS[theme],
  }
}

const LIGHT = paintFor('light')
const DARK = paintFor('dark')

export const ThemeContext = createContext<Theme>('light')

/** Color mapping for the theme currently being rendered. */
export function usePaint(): Paint {
  return useContext(ThemeContext) === 'dark' ? DARK : LIGHT
}

/** Whether the OS/browser prefers dark mode, updating live when it changes. */
export function useSystemDark(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  const [dark, setDark] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
    // The media query is the same every render; subscribe once.
  }, [])
  return dark
}

/** What a palette color is called, as seen in this theme (black ink shows as white in dark mode). */
export function colorName(names: Record<string, string>, color: string, theme: Theme): string {
  const name = names[color] ?? color
  if (theme === 'dark' && name === 'Black') return 'White'
  return name
}
