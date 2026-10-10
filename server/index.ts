/**
 * Production server: serves the built app from dist/ and hosts the board
 * WebSocket on the same port. Build first (`npm run build`), then `npm start`.
 * Environment: PORT (default 8787), DATA_DIR (default ./data/boards),
 * ADMIN_TOKEN (enables deleting boards via the API; unset = disabled),
 * ACCESS_KEY (shared key required to open boards and list them; unset = open to anyone).
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createBoardServer } from './boards.ts'

const PORT = Number(process.env.PORT) || 8787
const DIST = path.resolve('dist')
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data/boards')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first.')
  process.exit(1)
}

// ADMIN_TOKEN enables the board-deletion API; without it, deleting is disabled.
// ACCESS_KEY restricts boards to people who have the key; without it, anyone may use them.
const boards = createBoardServer({ dataDir: DATA_DIR, adminToken: process.env.ADMIN_TOKEN, accessKey: process.env.ACCESS_KEY })

const server = http.createServer((req, res) => {
  if (boards.handleRequest(req, res)) return
  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400).end('Bad request')
    return
  }
  let file = path.resolve(DIST, '.' + pathname)
  // Never serve outside dist/; unknown paths (e.g. /board/<id>) get the app.
  if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html')
  }
  const hashed = file.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
})

server.on('upgrade', (req, socket, head) => {
  if (!boards.handleUpgrade(req, socket, head)) socket.destroy()
})

server.listen(PORT, () =>
  console.log(
    `Whiteboard running at http://localhost:${PORT} (boards in ${DATA_DIR}; ${process.env.ACCESS_KEY ? 'access key required' : 'open to anyone'})`,
  ),
)

const shutdown = async () => {
  await boards.close()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
