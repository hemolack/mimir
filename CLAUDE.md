# Mimir

React 19 + TypeScript + Vite whiteboard. SVG rendering, pointer events (mouse, touch, pen), state saved to localStorage.

## Commands

- `npm run dev` — dev server on http://localhost:5173, including the collaboration WebSocket (`/ws`)
- `npm run build && npm start` — production: one Node process serves `dist/` and `/ws` (env `PORT`, default 8787; `DATA_DIR`, default `data/boards`)
- `npm run verify` — typecheck + unit tests + production build; run before calling work done
- `npm test` — vitest unit tests only (`src/*.test.ts`)

## Layout

- `src/types.ts` — data model: `ShapeElement`, `LineElement` (with optional bindings to shapes), `PathElement` (freehand brush), `CurveElement` (fitted Béziers)
- `src/geometry.ts` — pure geometry: shape outlines, connector routing (`linePoints`), hit tests, resizing
- `src/curveFit.ts` — freehand → cubic Bézier fitting for the Curve tool (resample, corner split, Schneider least-squares fit); tolerances are in screen px, divided by zoom
- `src/curveEdit.ts` — point editing for curves: flat points ⇄ nodes (anchor + in/out handles), move with handle mirroring, smooth/corner toggle, delete, shape-preserving split
- `src/transform.ts` — rotate/scale/flip for any selection. Shapes store `rotation`/`flipX`/`flipY` (outline flips, label never mirrors); point-based elements have their points transformed. Stroke widths don't scale.
- `src/ops.ts` — pure element operations (move, delete, clone, z-order); keep these side-effect free and tested
- `src/boardStore.ts` (+ `useBoard.ts` hook) — element store + per-user undo/redo. Call `checkpoint()` before a change you want undoable (or `change()`). Undo reverts only the properties this user changed, so it never clobbers collaborators.
- `src/patch.ts` — `Patch` (upserts/deletes/order): the unit of change for both sync and undo
- `src/sync.ts` — client sync: view = server-confirmed state + own unacknowledged ops; the server echoes every op to everyone in one order, so clients converge
- `server/boards.ts` — WebSocket rooms (`/ws?board=<id>`), sanitizes input, persists to `data/boards/<id>.json`; `server/index.ts` is the production entry; `vite.config.ts` mounts the same rooms in dev
- `src/components/optionItems.tsx` — what the palette's bottom options area shows: `lineToolOptions` (Line tool defaults) and `selectionOptions` (restyle the selection; each option appears only if something selected has that property). Add new per-element options here, not in `Palette.tsx`.
- `src/exporters.ts` — PNG/PDF/SVG export. Clones the on-screen content layer, swaps HTML (`foreignObject`) labels for wrapped SVG `<text>`, drops click-target paths; PNG rasterizes that SVG, PDF uses `jspdf` + `svg2pdf.js` (lazy-loaded) with Helvetica. Pure layout math is in `src/exportLayout.ts`.
- Board API (`handleRequest` in `server/boards.ts`): `GET /api/boards`; `DELETE /api/boards/<id>` and `DELETE /api/boards?olderThanDays=N` need `Authorization: Bearer $ADMIN_TOKEN` (unset = disabled). Deleting sends `{type:'deleted'}` to connected clients, which stop syncing for good; a deleted room is flagged so it's never saved again.
- `src/protocol.ts` — wire messages shared by client and server
- Routing: `/` = private board in localStorage; `/board/<id>` = shared board
- `src/embed.ts` — embed mode: on automatically inside an iframe, `?embed=1`/`?embed=0` to force. The top bar hides participants, Share, and frame-navigating menu items (`TopBar` `embedded` prop).
- `src/components/Canvas.tsx` — all pointer interaction (gesture state machine), selection overlay, context menu and label editor placement
- `src/storage.ts` — localStorage load/save and validation of untrusted board data

## Design notes

- `docs/design/signalr-backend.md` — proposed (not built) optional ASP.NET Core SignalR backend alongside the Node server.
- `docs/design/embedding-and-security.md` — proposed (not built) iframe embedding, embed mode, and security hardening (origin checks, `frame-ancestors`, stricter validation, access tokens, rate limits).

## Theming (light/dark)

- `src/theme.ts`: elements always store light-mode colors; dark mode maps them at render time via `usePaint()` (`ink` for strokes/text/brush, `fill` for fills, `paper` for hollow caps and line-label tags). Never write mapped colors back into elements.
- New element views must take colors through `usePaint()`; new UI CSS must use the variables in `styles.css` (`:root` and `:root[data-theme='dark']`), not hard-coded colors.
- Export renders the board in the export's chosen theme: `App.runExport` flips `renderTheme` with `flushSync`, calls the synchronous `prepareExport`, and flips back in the same task (no visible flash). Keep `prepareExport` synchronous.
- `CANVAS` in `theme.ts` must match `--bg` in `styles.css`.

## Conventions and gotchas

- Shape geometry (hit tests, connector attachment, resize) must go through `toLocal`/`fromLocal` in `geometry.ts` so rotated shapes work.
- To test in the browser without touching the user's board, use the `whiteboard-test` launch config (port 5174 = separate localStorage).
- Don't rewrite source files with PowerShell `Get-Content`/`Set-Content`: it reads with the ANSI code page and mangles non-ASCII (°, ×, ⌘).
- Gestures that compute from a start-of-gesture snapshot must merge only the ids they touch into the live board (`mergeFrom` in Canvas), or they'd wipe out concurrent remote changes.
- Files imported by `vite.config.ts` (server/boards.ts and its src/ imports) use explicit `.ts` import extensions; keep that chain extension-complete. Changes to server code need a dev-server restart.
- React StrictMode mounts effects twice in dev, so the app opens and immediately closes an extra WebSocket; the server must tolerate sockets that close before saying hello.
- World vs screen coordinates: `screen = world * zoom + (viewport.x, viewport.y)`. Elements are stored in world coordinates.
- Lines bound to shapes are resolved at render time via `linePoints`; `start`/`end` are only authoritative for unbound ends. Bindings survive moving/rotating/scaling the line itself (the attachment slides along the outline); only dragging an end off a shape, deleting the shape, or copying the line alone removes them. When deleting or copying, use `removeElements` / `bakeLines` so bound ends keep their positions.
- Attachment points use the real outline (`boundaryPoint`: ellipse/diamond analytically, triangle/parallelogram/hexagon via `outlinePolygon`, others the box). New polygonal shapes need an `outlinePolygon` entry.
- The canvas `preventDefault`s `mousedown` so it never steals focus; otherwise a label editor opened on pointerdown is blurred immediately.
- Don't use `window.prompt`/`confirm`/`alert`: embedded browsers (e.g. the Claude desktop preview) throw on `prompt()` and auto-cancel `confirm()`. Use `TextDialog` / `ConfirmDialog` from `src/components/Dialogs.tsx`.
- The dev server hot-reloads after every file write, so when a change spans several edits, add declarations/exports before their uses. A half-applied state (e.g. a component using an import that doesn't exist yet) can leave a blank page that only a dev-server restart clears.
- Don't put `//` comments between JSX attributes — the Vite 8 transform silently drops the following prop. Put comments above the element.
- Labels render in `foreignObject` with inline styles so SVG export stays self-contained.
