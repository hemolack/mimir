import type { ReactNode } from 'react'
import { capPath, dashArray, shapeDetail, shapePath } from '../geometry'
import type { Cap, LinePreset, ShapeKind } from '../types'

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SelectIcon = () => (
  <Icon>
    <path d="M5 3l14 8-6.5 1.5L10 19z" />
  </Icon>
)
export const HandIcon = () => (
  <Icon>
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 13.5a1.5 1.5 0 0 1 2.5-1.5L8 15" />
  </Icon>
)
export const PenIcon = () => (
  <Icon>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />
    <path d="M14.5 6.5l3 3" />
  </Icon>
)
export const CurveIcon = () => (
  <Icon>
    <path d="M4 18C6 6 12 6 12 12S18 18 20 6" />
    <circle cx="4" cy="18" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="20" cy="6" r="1.6" fill="currentColor" />
  </Icon>
)
export const MoveIcon = () => (
  <Icon>
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </Icon>
)
export const ScaleIcon = () => (
  <Icon>
    <rect x="3" y="11" width="10" height="10" rx="1" />
    <path d="M9 3h12v12" strokeDasharray="2.5 2.5" />
    <path d="M12 12l8-8M15 4h5v5" />
  </Icon>
)
export const RotateIcon = () => (
  <Icon>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v5h-5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </Icon>
)
export const Rotate90Icon = () => (
  <Icon size={18}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6" />
    <path d="M18 3v4h-4" />
    <rect x="9" y="12" width="9" height="8" rx="1" />
  </Icon>
)
export const FlipHIcon = () => (
  <Icon size={18}>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M9 6L3 18h6z" />
    <path d="M15 6l6 12h-6z" fill="currentColor" fillOpacity={0.25} />
  </Icon>
)
export const FlipVIcon = () => (
  <Icon size={18}>
    <path d="M3 12h18" strokeDasharray="2 2" />
    <path d="M6 9L18 3v6z" />
    <path d="M6 15l12 6v-6z" fill="currentColor" fillOpacity={0.25} />
  </Icon>
)
export const SmoothPointIcon = () => (
  <Icon size={18}>
    <path d="M3 17C7 7 17 7 21 17" />
    <path d="M5 8h14" strokeDasharray="2 2" />
    <circle cx="12" cy="8" r="2.2" fill="currentColor" />
  </Icon>
)
export const CornerPointIcon = () => (
  <Icon size={18}>
    <path d="M3 18L12 7l9 11" />
    <rect x="10" y="5" width="4" height="4" fill="currentColor" />
  </Icon>
)
export const DeletePointIcon = () => (
  <Icon size={18}>
    <path d="M3 17C7 9 17 9 21 17" />
    <circle cx="12" cy="11" r="2.2" />
    <path d="M16 3l5 5M21 3l-5 5" />
  </Icon>
)
export const EraserIcon = () => (
  <Icon>
    <path d="M8 20h12M5.5 16.5l9-9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L12 18H8z" />
    <path d="M10 12l4.5 4.5" />
  </Icon>
)
export const TextIcon = () => (
  <Icon>
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  </Icon>
)
export const UndoIcon = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)
export const RedoIcon = () => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
)
export const TrashIcon = () => (
  <Icon size={18}>
    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
  </Icon>
)
export const CopyIcon = () => (
  <Icon size={18}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
)
export const FrontIcon = () => (
  <Icon size={18}>
    <rect x="3" y="3" width="11" height="11" rx="1.5" strokeDasharray="2 2.5" />
    <rect x="10" y="10" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity={0.25} />
  </Icon>
)
export const BackIcon = () => (
  <Icon size={18}>
    <rect x="3" y="3" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity={0.25} />
    <rect x="10" y="10" width="11" height="11" rx="1.5" strokeDasharray="2 2.5" />
  </Icon>
)
export const LabelIcon = () => (
  <Icon size={18}>
    <path d="M4 7V5h10v2M9 5v12M7 17h4" />
    <path d="M14 19l5.5-5.5a1.4 1.4 0 0 0-2-2L12 17l-.5 2.5z" />
  </Icon>
)
export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)
export const PlusIcon = () => (
  <Icon size={16}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const MinusIcon = () => (
  <Icon size={16}>
    <path d="M5 12h14" />
  </Icon>
)
export const ElbowIcon = () => (
  <Icon size={18}>
    <path d="M4 6h8v12h8" />
  </Icon>
)
export const StraightIcon = () => (
  <Icon size={18}>
    <path d="M4 18L20 6" />
  </Icon>
)

export function ShapeIcon({ kind }: { kind: ShapeKind }) {
  const square = kind === 'square' || kind === 'circle'
  const w = square ? 18 : 22
  const h = square ? 18 : 15
  const detail = shapeDetail(kind, w, h)
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`translate(${(24 - w) / 2} ${(24 - h) / 2})`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
        <path d={shapePath(kind, w, h)} />
        {detail && <path d={detail} />}
      </g>
    </svg>
  )
}

export function LineIcon({ preset }: { preset: Pick<LinePreset, 'dash' | 'startCap' | 'endCap' | 'routing'> }) {
  const pts =
    preset.routing === 'elbow'
      ? [
          { x: 3, y: 18 },
          { x: 12, y: 18 },
          { x: 12, y: 6 },
          { x: 21, y: 6 },
        ]
      : [
          { x: 3, y: 20 },
          { x: 21, y: 4 },
        ]
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
  const n = pts.length
  const caps = [capPath(preset.startCap, pts[0], pts[1], 0.4), capPath(preset.endCap, pts[n - 1], pts[n - 2], 0.4)]
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeDasharray={dashArray(preset.dash, 1.2)} strokeLinecap="round" strokeLinejoin="round" />
      {caps.map((c, i) => c && <path key={i} d={c.d} fill={c.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />)}
    </svg>
  )
}

export function CapIcon({ cap, flip }: { cap: Cap; flip?: boolean }) {
  const a = { x: flip ? 20 : 4, y: 12 }
  const b = { x: flip ? 4 : 20, y: 12 }
  const c = capPath(cap, b, a, 0.4)
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
      <path d={`M${a.x} 12 L${b.x} 12`} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      {c && <path d={c.d} fill={c.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  )
}
