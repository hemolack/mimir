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

> ⚠️ Anyone who knows a board's URL can view and edit it, and the server has no rate limiting yet. Read [docs/design/embedding-and-security.md](docs/design/embedding-and-security.md) before exposing it on the public internet.

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

   Optional parameters: `repoUrl` (default `https://github.com/hemolack/mimir.git`; use your fork's URL if you have one, it must be public), `branch` (default `master`), `skuName` (default `B1`) and `nodeVersion` (default `NODE|22-lts`; list options with `az webapp list-runtimes --os linux`). To check the template without deploying: `az bicep build --file infra/main.bicep`.

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
- **Custom domain / restricting access:** configure these on the web app in the Azure portal; see the security note above before making boards public.
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

If you sandbox the iframe, include `allow-downloads` so exports still work. The server doesn't yet restrict which sites may frame it or connect to it; the recommended hardening (`frame-ancestors`, origin checks, input validation, access tokens) is described in [docs/design/embedding-and-security.md](docs/design/embedding-and-security.md).

## SignalR (ASP.NET Core) backend

**Not implemented yet.** The design for an optional ASP.NET Core SignalR backend alongside the Node server is in [docs/design/signalr-backend.md](docs/design/signalr-backend.md).

## Project notes

Architecture, conventions and gotchas for contributors are in [CLAUDE.md](CLAUDE.md).
