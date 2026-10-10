# Mimir

A collaborative whiteboard built with React, TypeScript and Vite: shapes, connectors, freehand and Bézier drawing, live multi-user boards, light/dark themes, and PNG/PDF/SVG export.

- `/` — your private board, saved in the browser (localStorage)
- `/board/<id>` — a shared board; everyone with the link sees changes in real time

## Requirements

- Node.js 22 or newer (developed on Node 26) and npm
- For Azure deployment: the Azure CLI (see [Deploy to Azure](#deploy-to-azure-app-service))

## Install and run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server also hosts the collaboration WebSocket (`/ws`), so shared boards work with no extra setup. Shared boards are saved under `data/boards/`.

Before committing, run the full check (typecheck, unit tests, production build):

```bash
npm run verify
```

## Deploy (Node server)

Production is a single Node process that serves the built app and the WebSocket on one port:

```bash
npm ci
npm run build
npm start
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `DATA_DIR` | `data/boards` | Where shared boards are stored (JSON files) |
| `ADMIN_TOKEN` | *(unset)* | Enables deleting boards through the API (see [Board API](#board-api)). Unset = deleting disabled. Use a long random value. |
| `ACCESS_KEY` | *(unset)* | Shared key needed to open shared boards and list them (see [Restrict access](#restrict-access-access-key)). Unset = anyone can use the server. Use a long random value. |

Notes for any host (VM, PaaS, container):

- **Persistent storage:** `DATA_DIR` must survive restarts and redeploys — use a mounted volume, not a container's temporary filesystem.
- **One instance:** board state lives in the process, so run a single instance (no load-balanced replicas).
- **HTTPS:** put it behind a reverse proxy or platform TLS. The client automatically uses `wss://` on HTTPS pages.
- **WebSockets:** the proxy must pass upgrade requests on `/ws`. For nginx:

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:8787;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 1h;
  }
  ```

- **Process manager:** run `npm start` under systemd, pm2, or your platform's equivalent so it restarts on failure. It saves open boards on `SIGINT`/`SIGTERM`.

> ⚠️ Without `ACCESS_KEY`, anyone who knows a board's URL can view and edit it. The server has no rate limiting yet. Read [docs/design/embedding-and-security.md](docs/design/embedding-and-security.md) before exposing it on the public internet.

## Restrict access (access key)

Set `ACCESS_KEY` to keep shared boards to people who have the key, for example your organization. It's one shared key, not user accounts: nothing about individual users is tracked. Leave it unset and anyone can use the app, as before.

- **What's locked:** joining a shared board (the `/ws` connection) and `GET /api/boards`. The app's own files (HTML, JavaScript, CSS) stay public, because they contain no board content. The private board at `/` lives only in each browser and never reaches the server.
- **Entering the key:** opening a shared board without the key shows an *Access key required* dialog. The browser remembers the key, so people enter it once. If they cancel, an **Enter access key** button in the top bar brings the dialog back.
- **Links:** `https://<host>/board/team-retro?key=<key>` opens the board without the dialog. The app saves the key and removes it from the address bar, so it doesn't end up in screenshots or copied links. Treat such a link like the key itself.
- **Embedding:** put `?key=<key>` in the iframe's `src`. Browsers keep a framed site's storage separate for each host site, so a key entered on the main site doesn't carry over to an iframe.
- **Listing boards:** send `Authorization: Bearer <ACCESS_KEY>` (or the admin token), or add `?key=<key>` to open `/api/boards` in a browser. Prefer the header in scripts, because URLs end up in logs and browser history. In a URL, the key must be URL-encoded if it contains characters such as `+`, `&`, `#` or `/`. The access key can't delete boards; that still needs `ADMIN_TOKEN`.
- **Changing the key:** set a new `ACCESS_KEY` and restart. Everyone is asked for the new key the next time they connect. People already connected stay connected until they reload or lose the connection.

The key is sent inside the WebSocket connection (not in the URL), so it doesn't appear in server or proxy logs. Use HTTPS so it isn't sent in the clear. Anyone who has the key gets in, so change it if it leaks. For a second layer, also restrict the site to your organization's IP addresses (on Azure: **Networking → Access restrictions**).

## Board API

| Request | Auth | Result |
|---|---|---|
| `GET /api/boards` | access key (Bearer header or `?key=`), if `ACCESS_KEY` is set; the admin token also works | `{"boards": ["id", …]}` — every board with saved content. Just opening a board's URL doesn't create one; a board exists once something is drawn on it |
| `DELETE /api/boards/<id>` | admin token | `204` deleted · `404` no such board |
| `DELETE /api/boards?olderThanDays=N` | admin token | Deletes boards not modified in the last N days; boards someone has open are skipped. Returns `{"deleted": […], "skippedOpen": […]}` |

Deleting requires `Authorization: Bearer <ADMIN_TOKEN>`; without `ADMIN_TOKEN` configured on the server, deletes return `403`. People who have a deleted board open are told it was deleted and their app stops syncing, so it isn't recreated. Deletion is permanent — there's no undo or trash.

```bash
# Delete one board
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/api/boards/team-retro

# Delete boards untouched for 90 days
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "https://<host>/api/boards?olderThanDays=90"
```

On Windows PowerShell, use `curl.exe` (not the `curl` alias) or `Invoke-RestMethod -Method Delete -Headers @{ Authorization = "Bearer $env:ADMIN_TOKEN" } -Uri ...`.

For local development, set `ADMIN_TOKEN` in the environment before `npm run dev`.

## Deploy to Azure (App Service)

[`infra/main.bicep`](infra/main.bicep) creates a Linux App Service plan and web app configured for this server: Node runtime, `npm start`, WebSockets on, Always On, HTTPS only, one instance, and boards stored in `/home/data/boards` (App Service's persistent storage, kept across restarts and redeploys).

Deployment is **pull-based**: App Service clones this public GitHub repository itself (`master` branch) and builds it on Azure with `npm install` and `npm run build`. Nothing is pushed from GitHub: there is no Actions workflow or webhook, and a new commit is deployed only when you trigger a sync.

You need the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and an Azure subscription. The default plan size (B1) is a paid tier; Basic or higher is required for Always On and reliable WebSockets.

1. **Sign in and create a resource group** (pick your region):

   ```bash
   az login
   az group create --name whiteboard-rg --location eastus
   ```

2. **Create the infrastructure.** `appName` must be globally unique; it becomes `https://<appName>.azurewebsites.net`. Creating the web app also pulls and builds the code once (allow a few minutes):

   ```bash
   az deployment group create --resource-group whiteboard-rg --template-file infra/main.bicep --parameters appName=<your-app-name>
   ```

   To enable deleting boards through the [Board API](#board-api), also pass `adminToken=<long-random-value>`. To keep boards to people with a key (see [Restrict access](#restrict-access-access-key)), pass `accessKey=<long-random-value>`. Both are secure parameters, so they aren't shown in deployment logs. You can also set the `ADMIN_TOKEN` and `ACCESS_KEY` application settings in the portal later; changing an application setting restarts the app.

   Other optional parameters: `repoUrl` (default `https://github.com/hemolack/mimir.git`; use your fork's URL if you have one, it must be public), `branch` (default `master`), `skuName` (default `B1`) and `nodeVersion` (default `NODE|22-lts`; list options with `az webapp list-runtimes --os linux`). To check the template without deploying: `az bicep build --file infra/main.bicep`.

3. **Open it:** `https://<your-app-name>.azurewebsites.net`. To watch the server log: `az webapp log tail --resource-group whiteboard-rg --name <your-app-name>`.

To deploy updates, pull the latest commit from GitHub and rebuild (or press **Sync** in the portal under Deployment Center):

```bash
az webapp deployment source sync --resource-group whiteboard-rg --name <your-app-name>
```

Notes:

- **Not gated by tests:** the Azure build doesn't run `npm run verify`; run it before you push (a build that fails to compile just fails the sync and leaves the previous version running).
- **Scheduled pulls:** to pull automatically without GitHub pushing, call the sync command above from a timer on your side (for example an Azure Automation runbook or Logic App).
- **Don't scale out** beyond one instance: each board's live state is in the server process.
- **Idle connections** may be dropped by Azure's front end after a few minutes; the app reconnects automatically and resends any unsaved edits.
- **Custom domain / restricting access:** configure a custom domain in the Azure portal. To restrict access, set `ACCESS_KEY` (see [Restrict access](#restrict-access-access-key)), optionally adding IP **Access restrictions** under Networking.
- **Remove everything:** `az group delete --name whiteboard-rg`.
## Embed in another web page

Use an iframe pointing at a shared board:

```html
<iframe
  src="https://whiteboard.example.com/board/team-retro"
  allow="clipboard-write; fullscreen"
  style="width:100%; height:600px; border:0"
  title="Whiteboard"></iframe>
```

Inside an iframe the app switches to **embed mode** automatically: the top bar shows only the connection status (no participant avatars or Share button), and menu items that would navigate the frame to another board are hidden. Live cursors still show on the canvas. Add `?embed=0` to the URL to get the full interface in a frame, or `?embed=1` to force embed mode outside one.

If you sandbox the iframe, include `allow-downloads` so exports still work. The server doesn't yet restrict which sites may frame it or connect to it; the recommended hardening (`frame-ancestors`, origin checks, input validation, access tokens) is described in [docs/design/embedding-and-security.md](docs/design/embedding-and-security.md).

## SignalR (ASP.NET Core) backend

**Not implemented yet.** The design for an optional ASP.NET Core SignalR backend alongside the Node server is in [docs/design/signalr-backend.md](docs/design/signalr-backend.md).

## Project notes

Architecture, conventions and gotchas for contributors are in [CLAUDE.md](CLAUDE.md).
