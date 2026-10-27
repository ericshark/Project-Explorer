import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { ActivityIndex } from './activity.ts'
import { createApp } from './app.ts'
import { findAllRepos } from './discovery.ts'
import { Fetcher } from './fetcher.ts'
import { ProcessManager } from './processes.ts'

const HUB_PORT = Number(process.env.HUB_PORT ?? 4600)
const PID_FILE = fileURLToPath(new URL('../.hub/pids.json', import.meta.url))
const VISIBILITY_FILE = fileURLToPath(new URL('../.hub/visibility.json', import.meta.url))
const SHUTDOWN_TIMEOUT_MS = 10_000

const processes = new ProcessManager(PID_FILE)
const fetcher = new Fetcher()
const activity = new ActivityIndex({ visibilityFile: VISIBILITY_FILE })
fetcher.on('change', (state) => {
  if (!state.running) activity.forgetVisibility()
})
const reaped = processes.reapOrphans()
if (reaped > 0) {
  console.log(`[project-explorer] stopped ${reaped} process group(s) left over from a previous run`)
}

const server = serve(
  { fetch: createApp(processes, fetcher, activity).fetch, port: HUB_PORT, hostname: '127.0.0.1' },
  (info) => {
    console.log(`[project-explorer] Project Explorer running at http://localhost:${info.port}`)
    // Ahead/behind is only as fresh as the remote branches, so they're fetched once at startup.
    const repos = findAllRepos()
    console.log(`[project-explorer] fetching ${repos.length} repos in the background…`)
    void fetcher.fetchAll(repos).then(({ failed }) => {
      const note = failed.length ? ` (${failed.length} failed: ${failed.join(', ')})` : ''
      console.log(`[project-explorer] fetch finished${note}`)
    })
  },
)

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[project-explorer] Port ${HUB_PORT} is in use. Start with HUB_PORT=<port> to pick another.`,
    )
    process.exit(1)
  }
  throw error
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) {
    // A second Ctrl-C means "now".
    processes.killAllNow()
    process.exit(1)
  }
  shuttingDown = true
  console.log(`[project-explorer] ${signal} received, stopping dev servers…`)
  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
  await Promise.race([processes.stopAll(), timeout])
  processes.killAllNow()
  server.close()
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => void shutdown(signal))
}
process.on('exit', () => processes.killAllNow())
