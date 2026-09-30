import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// Explicit .ts extensions along this import chain keep it loadable by Vite's native config loader.
import { createBoardServer } from './server/boards.ts'

/** Runs the collaboration WebSocket (/ws) inside the dev server, so `npm run dev` is all you need. */
function boardSync(): Plugin {
  return {
    name: 'board-sync',
    configureServer(server) {
      if (process.env.VITEST) return // tests start their own server
      const boards = createBoardServer({ dataDir: 'data/boards' })
      // Vite's own HMR socket only answers its own protocol, so /ws upgrades are ours.
      server.httpServer?.on('upgrade', (req, socket, head) => {
        boards.handleUpgrade(req, socket, head)
      })
      server.httpServer?.on('close', () => void boards.close())
    },
  }
}

export default defineConfig({
  plugins: [react(), boardSync()],
})
