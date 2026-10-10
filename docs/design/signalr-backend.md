# Design: optional SignalR (ASP.NET Core) backend

**Status:** Proposed — not started. Written 2026-09-30 to revisit later.
**Goal:** Let shared boards (`/board/<id>`) run against an ASP.NET Core SignalR server as an alternative to the current Node WebSocket server, with identical behavior. Node stays the default.

**Estimate:** about a day of focused work (client transport switch ~½ day, C# server ~½ day, parity testing on top).

---

## 1. Where things stand today

Real-time sync is split so that the server is deliberately small and "dumb":

| Piece | File | Role |
|---|---|---|
| Wire protocol | `src/protocol.ts` | Message types shared by client and server (`hello`, `op`, `presence` → `init`, `op`, `presence`, `leave`, `error`) |
| Patches | `src/patch.ts` | `Patch = { upserts, deletes, order? }`, plus `applyPatch` / `mergePatches` / `diffElements` |
| Client sync | `src/sync.ts` | `SyncClient`: optimistic local edits, pending-op queue, reconnect with backoff, presence throttling |
| Validation | `src/storage.ts` | `sanitizeElements` — drops malformed elements from untrusted input |
| Server rooms | `server/boards.ts` (~190 lines) | Validates ops, applies them in arrival order, relays each op to **every** member (sender included, as its ack), persists `data/boards/<id>.json` |
| Prod entry | `server/index.ts` | Serves `dist/` + mounts `/ws` on one port |
| Dev entry | `vite.config.ts` | Mounts the same rooms inside the Vite dev server |
| End-to-end tests | `server/sync.test.ts` | Real server + real `SyncClient`s: convergence under conflicts, persistence, presence, mid-handshake race, bad input, bad board ids |

### The convergence model (must be preserved)

1. Each client applies its own edits immediately and queues them as pending ops.
2. The server applies ops **one at a time, in a single order**, and relays every op to every member of the board — including the sender.
3. Each client keeps `confirmed` = the server's state (every relayed op applied in server order). What it shows is `confirmed` + its own not-yet-acknowledged ops. When its own op comes back, it drops it from pending.

This is why all clients end up identical even when two people edit the same element at once. **The server's only hard obligation is a single, consistent order of ops per board, delivered to everyone.**

Everything else — per-user undo, merging, reconnect/resend, presence throttling — lives in the browser and is unaffected by the choice of server.

---

## 2. Proposed design

### 2.1 Client: pluggable transport

`SyncClient` touches the socket in only a few places (open, `onopen` → send `hello`, `onmessage`, `onclose`, `send`). Extract those behind a small interface:

```ts
// src/transport.ts
export interface Transport {
  /** Open (or reopen) the connection for a board. */
  connect(board: string): void
  send(msg: ClientMessage): void
  close(): void
  onOpen: () => void
  onMessage: (msg: ServerMessage) => void
  /** Connection lost (not after close()); SyncClient decides whether to retry. */
  onClose: () => void
  readonly isOpen: boolean
}
```

- `WebSocketTransport` — today's code, moved out of `SyncClient` unchanged (`/ws?board=<id>`).
- `SignalRTransport` — uses `@microsoft/signalr`:
  - URL: `/hub/boards?board=<id>` (board id in the query string, same as today).
  - One hub method in each direction, carrying the existing protocol unchanged: client calls `Send(message)`, server invokes `receive(message)` on clients. No per-message-type hub methods — keeps the two backends byte-for-byte equivalent at the protocol level.
  - **Disable SignalR's automatic reconnect** (don't call `withAutomaticReconnect`) and let `SyncClient`'s existing backoff reconnect drive it. After any reconnect the client must send `hello` again and receive a fresh `init`; our logic already does exactly that, and SignalR's own reconnect would skip it.
  - Use the JSON hub protocol (camelCase by default — matches our TS field names).

`SyncClient` takes a `Transport` (or a factory) in its constructor instead of building a `WebSocket` itself.

**Selecting the backend** — build-time env var, read in `App.tsx` where the `SyncClient` is created:

```
VITE_SYNC_BACKEND=ws        # default
VITE_SYNC_BACKEND=signalr
```

Load `@microsoft/signalr` with a dynamic `import()` only when `signalr` is selected, so the default build doesn't grow (same pattern as the PDF libraries in `src/exporters.ts`).

### 2.2 Server: ASP.NET Core project

New sibling folder `server-dotnet/` (minimal-API project, .NET 10 — the SDK is installed on the dev machine):

```
server-dotnet/
  Whiteboard.Server.csproj
  Program.cs            // DI, SignalR, static files + SPA fallback, limits
  BoardHub.cs           // connection lifecycle + Send(message)
  BoardRooms.cs         // singleton: rooms, per-room lock, apply/relay/persist
  Patch.cs              // ApplyPatch / ApplyOrder over JSON elements
  ElementValidator.cs   // port of sanitizeElements
  BoardStore.cs         // load/save data/boards/<id>.json (write-then-rename)
```

**Elements are opaque JSON.** The server never needs to understand shapes or lines — only `id`, `type`, and the validation rules. Keep elements as `JsonElement`/`JsonNode`; don't model the element types in C#.

**Hub lifecycle** (mirrors `server/boards.ts`):

- `OnConnectedAsync` — read `board` from the query string; reject if it doesn't match `^[A-Za-z0-9_-]{1,64}$` (same as `BOARD_ID_PATTERN`). Add the connection to the group for that board and register it with the room **immediately** (before `hello`) — see §3.2.
- `Send(message)`:
  - `hello` → record the peer (clientId/name/color, sanitized as today), reply to the caller with `init` (elements + current peers), announce `presence` to the others.
  - `op` → validate the patch, then **under the room's lock**: apply, enforce the 50,000-element cap (reply with `error` + an empty ack if exceeded, exactly as today), relay `{ type: 'op', clientId, opId, patch }` to the whole group, schedule a save.
  - `presence` → update and relay to others (no lock needed; ordering doesn't matter for presence).
- `OnDisconnectedAsync` — remove the connection; send `leave` only if no other connection in the room has the same `clientId`; when the room has no connections left, save it and unload it.

**Hosting:** `UseDefaultFiles` + `UseStaticFiles` over the built `dist/`, `MapHub<BoardHub>("/hub/boards")`, and `MapFallbackToFile("index.html")` so `/board/<id>` loads the app. Config: `PORT` (default 8787) and `DATA_DIR` (default `data/boards`), same as the Node server.

### 2.3 Dev setup

- Run the ASP.NET server (`dotnet watch` in `server-dotnet/`) on its own port.
- Add a Vite proxy entry: `'/hub': { target: 'http://localhost:<port>', ws: true }`.
- Start Vite with `VITE_SYNC_BACKEND=signalr`. The Node board server inside Vite simply goes unused.

---

## 3. Pitfalls (the parts a straight port gets wrong)

### 3.1 Op ordering — needs an explicit lock

Node is single-threaded, so ops were applied and relayed in one global order for free. **ASP.NET runs hub invocations concurrently.** Without serialization, two ops for the same board can be applied in one order and relayed in another, and clients silently diverge — no error, just different boards.

Fix: a `SemaphoreSlim(1, 1)` per room held across *apply + relay*. Relaying inside the lock (sequential `SendAsync` to the group) keeps per-connection delivery order equal to apply order. Different boards don't block each other.

### 3.2 Mid-handshake race

We already hit this on Node: a room was unloaded when its last *greeted* member left while another socket had connected but not yet sent `hello`; that socket joined an orphaned room and newcomers never saw its edits. React StrictMode's double-mounting in dev makes it likely. Count **every** connection toward room membership from `OnConnectedAsync`, not just those that have said hello. (`server/sync.test.ts` → "keeps a mid-handshake connection in the same room…" covers this.)

### 3.3 Message size limit

SignalR's default `MaximumReceiveMessageSize` is **32 KB**. A long freehand stroke or a large paste easily exceeds that and the connection gets dropped. Set it to 8 MB to match the Node server's `maxPayload`.

### 3.4 Reconnect semantics

Don't use SignalR's automatic reconnect (see §2.1). If it's ever enabled, the reconnected handler must send `hello` again and wait for `init`; otherwise pending ops are resent against a stale view.

### 3.5 Validation drift

`sanitizeElements` would exist in TypeScript and C#. Mitigation: run the same end-to-end tests against both servers (§4), including the "rejects invalid elements" case. If this becomes a burden, move the rules to a JSON Schema consumed by both sides.

### 3.6 Leave vs. duplicate client ids

A replaced connection's departure must not hide its successor: send `leave` only when no remaining connection shares that `clientId` (same rule as the Node server).

---

## 4. Testing plan

- Parameterize `server/sync.test.ts` over a backend: it already drives real `SyncClient`s against a real server. Add a mode that points them at a running ASP.NET server through `SignalRTransport`. Every existing case must pass unchanged against both:
  - basic propagation (add / move / delete)
  - convergence under 20 rounds of conflicting edits to the same element
  - presence (cursor, selection, rename) and leave
  - persistence and reload for later visitors
  - edits made before `init` arrives
  - invalid elements dropped without breaking the room
  - mid-handshake race
  - non-URL-safe board ids refused
- Add one SignalR-specific test: an op larger than 32 KB succeeds (guards §3.3).
- Optional: a small xUnit suite for `Patch.cs` and `ElementValidator.cs`, mirroring `src/patch.test.ts`.

---

## 5. Work breakdown

1. Extract `Transport` from `SyncClient`; move current code to `WebSocketTransport`; no behavior change (existing tests stay green).
2. Add `SignalRTransport` + `VITE_SYNC_BACKEND` switch + lazy import.
3. Scaffold `server-dotnet/`; port patch application, validation, persistence.
4. Hub + rooms with per-room lock, 8 MB limit, element cap, leave rule.
5. Static hosting + SPA fallback; dev proxy.
6. Parameterize the end-to-end tests; run against both backends.
7. Update `CLAUDE.md` (commands, backend switch, the locking rule).

## 6. Open questions

- Should one deployment support **both** backends at once (e.g. choose at runtime), or is a build-time switch enough? Build-time is simpler and is what this design assumes.
- Storage: keep JSON files for parity, or is a database (SQL Server, Redis) wanted on the .NET side? The room API is small enough to put behind an interface either way.
- Scale-out: with multiple ASP.NET instances, SignalR needs a backplane (Azure SignalR Service or Redis), **and** the per-room lock/state must live in one place — e.g. route each board to a single instance. Out of scope for a first version; the Node server has the same single-process limitation today.
- Auth: none today (anyone with the link can edit). ASP.NET makes adding authentication straightforward if that's a reason for the switch — decide before building.
