# Whiteboard

React 19 + TypeScript + Vite whiteboard. SVG rendering, pointer events (mouse, touch, pen), state saved to localStorage.

## Commands

- `npm run dev` — dev server on http://localhost:5173
- `npm run verify` — typecheck + unit tests + production build; run before calling work done
- `npm test` — vitest unit tests only (`src/*.test.ts`)

## Layout

- `src/types.ts` — data model: `ShapeElement`, `LineElement` (with optional bindings to shapes), `PathElement` (freehand brush), `CurveElement` (fitted Béziers)
- `src/geometry.ts` — pure geometry: shape outlines, connector routing (`linePoints`), hit tests, resizing
- `src/curveFit.ts` — freehand → cubic Bézier fitting for the Curve tool (resample, corner split, Schneider least-squares fit); tolerances are in screen px, divided by zoom
- `src/curveEdit.ts` — point editing for curves: flat points ⇄ nodes (anchor + in/out handles), move with handle mirroring, smooth/corner toggle, delete, shape-preserving split
- `src/transform.ts` — rotate/scale/flip for any selection. Shapes store `rotation`/`flipX`/`flipY` (outline flips, label never mirrors); point-based elements have their points transformed. Stroke widths don't scale.
- `src/ops.ts` — pure element operations (move, delete, clone, z-order); keep these side-effect free and tested
- `src/useBoard.ts` — element store + undo/redo. State lives in a ref; call `checkpoint()` before a change you want undoable (or `change()`)
- `src/components/Canvas.tsx` — all pointer interaction (gesture state machine), selection overlay, context menu and label editor placement
- `src/storage.ts` — localStorage load/save and validation of untrusted board data

## Conventions and gotchas

- Shape geometry (hit tests, connector attachment, resize) must go through `toLocal`/`fromLocal` in `geometry.ts` so rotated shapes work.
- To test in the browser without touching the user's board, use the `whiteboard-test` launch config (port 5174 = separate localStorage).
- Don't rewrite source files with PowerShell `Get-Content`/`Set-Content`: it reads with the ANSI code page and mangles non-ASCII (°, ×, ⌘).
- World vs screen coordinates: `screen = world * zoom + (viewport.x, viewport.y)`. Elements are stored in world coordinates.
- Lines bound to shapes are resolved at render time via `linePoints`; `start`/`end` are only authoritative for unbound ends. When deleting or copying, use `removeElements` / `bakeLines` so bound ends keep their positions.
- The canvas `preventDefault`s `mousedown` so it never steals focus; otherwise a label editor opened on pointerdown is blurred immediately.
- Don't put `//` comments between JSX attributes — the Vite 8 transform silently drops the following prop. Put comments above the element.
- Labels render in `foreignObject` with inline styles so SVG export stays self-contained.
