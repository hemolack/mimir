# Design: embedding in other pages, and security hardening

**Status:** Proposed — not started. Written 2026-10-01 to revisit later.
**Goal:** Let other sites embed a board, and close the security gaps that matter once the app is reachable from the public internet.

**Recommendation:** embed with an `<iframe>`; before any public embed, do the hardening in §4 step 1 (a few hours, mostly in `server/`).

---

## 1. How to embed

### 1.1 Option A — `<iframe>` (recommended)

```html
<iframe
  src="https://whiteboard.example.com/board/team-retro"
  allow="clipboard-write; fullscreen"
  style="width:100%; height:600px; border:0"
  title="Whiteboard"></iframe>
```

Works today with no code changes, because the app is self-contained:

- Its global CSS (`html, body { overflow: hidden }`, generic class names), `position: fixed` layout, window-level keyboard shortcuts (Delete, Backspace, Ctrl+A, Space) and `data-theme` on `<html>` all stay inside the frame.
- `SyncClient` builds its WebSocket URL from the frame's own `location` (`src/sync.ts`), so it reaches the right server and uses `wss:` on HTTPS pages automatically.
- The app no longer uses `window.prompt`/`confirm`, which are often blocked inside frames (see `src/components/Dialogs.tsx`).

Things to know when framing it:

| Topic | Behavior | What to do |
|---|---|---|
| Copy link | Clipboard writes need permission in iframes | `allow="clipboard-write"`; the app falls back to its own copy-link dialog |
| Exports | Downloads are blocked in sandboxed iframes | Add `allow-downloads` if the host uses `sandbox` |
| Keyboard shortcuts | Only work while the frame has focus | Usually desirable |
| Storage | Browsers partition iframe storage per top-level site, so the private board and display name differ from the standalone app | Expected; mostly affects the private (`/`) board |
| Navigation | Share / New shared board / Open my private board change the *frame's* URL | Add an embed mode that hides them (§3.1) |

### 1.2 Option B — mount as a component in the host page (not recommended yet)

A library build (e.g. `mountWhiteboard(element, options)`) would need refactoring, because the app currently assumes it owns the page:

- Keyboard listener on `window` (`App.tsx`) would capture the host page's Delete / Backspace / Ctrl+A.
- Sets `data-theme` on `<html>` and the `theme-color` meta tag; global CSS (`html`, `body`, `button`, `.panel`, `.menu`, …).
- `position: fixed` full-viewport layout.
- Board id comes from `location.pathname`; navigation uses `location.assign`.
- WebSocket host is `location.host` — would need a configurable server URL.

Roughly a day of work: scope CSS (shadow DOM or a prefixed class root), attach keyboard handling to the component's root element, take board id / server URL / theme as options, and replace `location` usage with callbacks. Only worth it if the board must share the page with other content, or the host needs control an iframe can't give.

---

## 2. Security assessment

Findings are against the current code (`server/boards.ts`, `server/index.ts`, `src/storage.ts`).

### 2.1 CORS — not a real concern for the iframe approach

The frame loads its own pages and assets from its own origin, and WebSockets aren't subject to CORS at all (which is why §2.2 matters). CORS only becomes relevant for Option B or if HTTP APIs are added later.

### 2.2 Cross-Site WebSocket Hijacking (CSRF for WebSockets) — gap

The server doesn't check the `Origin` header on the WebSocket upgrade (`handleUpgrade` in `server/boards.ts`). Any website can open a socket to a board whose id it knows.

- **Today:** low impact — there are no cookies or logins, so a hostile site gains nothing it couldn't do by connecting directly.
- **Becomes a real CSRF hole the moment cookie-based auth is added.**
- **Fix:** reject upgrades whose `Origin` isn't the app's own origin or an allowlisted embedding host (configurable, e.g. `ALLOWED_ORIGINS`).

### 2.3 Clickjacking — unprotected

`server/index.ts` sends no `X-Frame-Options` or CSP, so *any* site can frame the app. Impact is limited (destructive actions confirm via in-app dialogs and are undoable), but it should be restricted.

- **Fix:** `Content-Security-Policy: frame-ancestors 'self' https://allowed-host.example` — this both permits the intended embedders and blocks everyone else. (`frame-ancestors` supersedes `X-Frame-Options`.) Same allowlist as §2.2.
- While there, add a baseline CSP for the app itself: the Vite build has no inline scripts, so `script-src 'self'` is feasible; `connect-src` must include the `wss:` origin. (Verify the lazily-loaded PDF libraries work under it before enforcing.)

### 2.4 XSS — rendering is safe; server-side validation is too loose

Safe today:

- React escapes all text; there's no `dangerouslySetInnerHTML` or `innerHTML` anywhere in `src/`.
- Labels and peer names render as text nodes; exports set labels via `textContent` and serialize with `XMLSerializer`.
- Peer colors are validated as `#rrggbb` on the server.

Gap: `sanitizeElements` (`src/storage.ts`) — used by the server and by "Open file" — only checks ids, element type, and numeric fields. Colors (`stroke`, `fill`), `label`, `kind`, `dash`, `startCap`/`endCap`, `routing` are accepted as **any string of any length**. These flow into SVG attributes and inline styles. React's attribute handling prevents script injection, but a hostile collaborator can still send multi-megabyte labels, `fill="url(...)"` references, or values the renderer doesn't expect.

**Fix:** tighten `sanitizeElements` (one function, shared by server and client):

- Colors: `#rgb`/`#rrggbb`, `none`, or `transparent` only.
- Enums (`kind`, `dash`, caps, `routing`, booleans like `closed`/`highlighter`/`flipX`): must be known values.
- Length caps: labels (e.g. 2,000 chars), ids (64), point arrays (e.g. 20,000 points per stroke).
- Numbers: finite and within sane ranges (sizes > 0, font size 4–400, etc.).
- Add cases to the "rejects invalid elements" end-to-end test in `server/sync.test.ts`.

### 2.5 Access control — the biggest issue for embedding

A board id **is** the edit permission: anyone with it can view and edit. Embedding `<iframe src=".../board/team-retro">` on a public page publishes edit access to everyone who views the page source.

- Random ids from **Share** (12 chars base64url, ~72 bits) are unguessable; hand-picked ids like `team-retro` are not.
- **Fix:** signed, short-lived tokens issued by the host's backend, e.g. `?token=<JWT>` carrying `{ board, user, role: 'edit' | 'view', exp }`. The WebSocket server verifies the signature before joining the room, and enforces the role (drop `op` messages from viewers). This also enables:
  - a **read-only embed** (hide tools; ignore edits),
  - **real user names** instead of self-chosen ones (§2.7).
- **Built since:** an optional shared `ACCESS_KEY` (see README, "Restrict access"). It keeps boards to people who have the key, but it's one key for everyone, so it's no substitute for per-board or per-user tokens.

### 2.6 Denial of service / abuse

- **Unbounded board files:** a room is saved when its last socket leaves *even if empty* (`save(r)` in the `close` handler in `server/boards.ts`). Cycling random ids creates unlimited files in `data/boards/`.
- **No rate limits:** connections and ops per socket/IP are unlimited; messages may be up to 8 MB; boards up to 50,000 elements.
- **Fix:** don't persist boards that were never non-empty; per-connection and per-IP rate limits on ops and new connections; a cap on the number of boards (or require auth to create one); consider a lower message cap for viewers.

### 2.7 Presence spoofing — minor

`name` and `clientId` are client-chosen, so anyone can appear as anyone. A forged `clientId` can also cause confusing `leave` messages. Fixed by deriving identity from the signed token (§2.5).

### 2.8 Host ↔ iframe messaging (if added)

If a `postMessage` API is added (e.g. "export PNG", "set theme", "board changed"):

- Always check `event.origin` against the allowlist before acting.
- Always post with an explicit `targetOrigin`, never `'*'`.
- Never pass tokens through messages to unverified origins.

---

## 3. Features for embedding

### 3.1 Embed mode

`?embed=1` (or a token claim):

- Hide **Share**, **New shared board**, **Open my private board**.
- Optional: `?readonly=1` (honored only when backed by a view-only token) hides drawing tools and the options area.
- Optional: `?theme=light|dark` to match the host page.

### 3.2 Optional host API (`postMessage`)

Messages such as `whiteboard:export` (returns a Blob URL or data), `whiteboard:setTheme`, `whiteboard:changed` (debounced notification). Subject to §2.8.

---

## 4. Suggested order of work

1. **Hardening before any public embed** (a few hours, mostly `server/`):
   - `frame-ancestors` CSP (+ baseline CSP) in `server/index.ts`, with an `ALLOWED_ORIGINS` setting.
   - `Origin` check on WebSocket upgrade, same allowlist.
   - Tighter `sanitizeElements` (§2.4) with end-to-end tests.
   - Don't persist empty boards; basic rate limiting.
2. **Embed mode** (§3.1).
3. **Signed access tokens** (§2.5) if boards shouldn't be editable by anyone holding the link; read-only role.
4. **Host API** via `postMessage` (§3.2), if needed.

## 5. Open questions

- Which sites should be allowed to embed (the `frame-ancestors` / `Origin` allowlist)?
- Is "anyone with the link can edit" acceptable for embedded boards, or are tokens required from day one?
- Who issues tokens — the host application's backend, or a small auth endpoint in this server?
- Should the private (`/`) board be available at all in embed mode, given storage partitioning makes it per-host-site?
- Relationship to the optional SignalR backend (`signalr-backend.md`): the same origin allowlist, token validation and input validation would need implementing there too.
