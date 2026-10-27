import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { activityRepos, type ActivityIndex } from './activity.ts'
import { CONFIG_PATH, getConfig } from './config.ts'
import {
  buildDetail,
  buildSummary,
  findAllRepos,
  findRepo,
  resolveWorktree,
  type Repo,
} from './discovery.ts'
import type { Fetcher } from './fetcher.ts'
import { commitPaths, fileDiff, listChanges } from './changes.ts'
import {
  checkout,
  commitAll,
  fetchRepo,
  getGraph,
  listBranches,
  listCommits,
  listWorktrees,
  pull,
  push,
} from './git.ts'
import { capabilities, openIn } from './open.ts'
import { findFreePort, waitForFreePort } from './ports.ts'
import { isActive, type ProcessManager } from './processes.ts'
import { HttpError, localOnly, safeJoin } from './security.ts'
import {
  missingSetup,
  renderTemplate,
  resolveServices,
  resolveSetup,
  uninstall,
  usesPort,
} from './services.ts'
import type { FetchState, HubMeta, LogLine, OpenTarget, RunInfo } from '../shared/types.ts'

const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url))
const MAX_DOC_BYTES = 2 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

interface ActionBody {
  worktree?: string
  service?: string
  target?: OpenTarget
  all?: boolean
  branch?: string
  commit?: string
  message?: string
  paths?: string[]
}

function requireRepo(id: string): Repo {
  const repo = findRepo(id)
  if (!repo) throw new HttpError(404, `Unknown project "${id}"`)
  return repo
}

async function readBody(c: Context): Promise<ActionBody> {
  if (!c.req.header('content-type')?.includes('application/json')) {
    throw new HttpError(400, 'Expected a JSON body')
  }
  try {
    return (await c.req.json()) as ActionBody
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

export function createApp(processes: ProcessManager, fetcher: Fetcher, activity: ActivityIndex) {
  const app = new Hono()

  /**
   * Starts every service of a worktree (or just `only`), allocating ports for all of them first.
   * `preferredPorts` are tried before a fresh allocation, so a restart keeps its port.
   */
  async function startServices(
    repo: Repo,
    worktree: string,
    only?: string | string[],
    preferredPorts: Record<string, number | null> = {},
  ): Promise<RunInfo[]> {
    const override = getConfig().projects[repo.relPath]
    const services = resolveServices(worktree, override)
    const names = only === undefined ? null : [only].flat()
    const targets = names ? services.filter((service) => names.includes(service.name)) : services
    if (targets.length === 0) {
      throw new HttpError(
        names ? 404 : 400,
        names ? `No service "${names.join('", "')}"` : 'No services to run',
      )
    }

    // Every service gets a port, even ones not being started, so `{ports.<name>}` resolves.
    const reserved = processes.reservedPorts()
    const ports: Record<string, number | null> = {}
    for (const service of services) {
      const active = processes.findActive(repo.id, worktree, service.name, 'service')
      if (active) {
        ports[service.name] = active.port
      } else if (service.defaultPort && usesPort(service)) {
        const preferred = preferredPorts[service.name]
        const port =
          preferred && !reserved.has(preferred) && (await waitForFreePort(preferred))
            ? preferred
            : await findFreePort(service.defaultPort + 1, reserved)
        reserved.add(port)
        ports[service.name] = port
      } else {
        ports[service.name] = null
      }
    }

    const started: RunInfo[] = []
    for (const service of targets) {
      if (processes.findActive(repo.id, worktree, service.name, 'service')) continue
      const cwd = join(worktree, service.cwd ?? '')
      if (!existsSync(cwd)) throw new HttpError(400, `${service.name}: ${cwd} does not exist`)
      const port = ports[service.name]
      const render = (template: string) => {
        try {
          return renderTemplate(template, ports, service.name)
        } catch (error) {
          throw new HttpError(400, `${service.name}: ${(error as Error).message}`)
        }
      }
      const env = Object.fromEntries(
        Object.entries(service.env ?? {}).map(([key, value]) => [key, render(value)]),
      )
      const url = service.url
        ? render(service.url)
        : service.open && port
          ? `http://localhost:${port}`
          : null
      started.push(
        processes.start({
          projectId: repo.id,
          worktree,
          name: service.name,
          kind: 'service',
          command: render(service.command),
          cwd,
          env,
          port,
          url,
        }),
      )
    }
    return started
  }

  /** Runs setup steps one after another, stopping at the first failure. */
  async function runSetup(repo: Repo, worktree: string, all: boolean): Promise<string[]> {
    const setup = resolveSetup(worktree, getConfig().projects[repo.relPath])
    if (setup.length === 0) throw new HttpError(400, 'This project has no setup steps')
    const busy = processes
      .list({ projectId: repo.id, worktree })
      .some((info) => info.kind === 'setup' && isActive(info))
    if (busy) throw new HttpError(409, 'Setup is already running for this worktree')

    const missing = new Set(missingSetup(worktree, setup))
    const steps =
      all || missing.size === 0 ? setup : setup.filter((s) => !s.creates || missing.has(s.name))

    void (async () => {
      for (const step of steps) {
        const run = processes.start({
          projectId: repo.id,
          worktree,
          name: step.name,
          kind: 'setup',
          command: step.command,
          cwd: join(worktree, step.cwd ?? ''),
        })
        const final = await processes.waitForExit(run.id)
        if (final?.status !== 'exited' || final.exitCode !== 0) break
      }
    })()
    return steps.map((step) => step.name)
  }

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
    console.error('[project-explorer]', error)
    return c.json({ error: error.message || 'Internal error' }, 500)
  })

  app.use('*', localOnly)

  app.get('/api/meta', (c) => {
    const meta: HubMeta = {
      home: homedir(),
      roots: getConfig().roots,
      configPath: CONFIG_PATH,
      can: capabilities,
      fetch: fetcher.current,
    }
    return c.json(meta)
  })

  app.get('/api/projects', async (c) => {
    const repos = findAllRepos()
    return c.json(await Promise.all(repos.map((repo) => buildSummary(repo, processes))))
  })

  app.get('/api/projects/:id', async (c) => {
    return c.json(await buildDetail(requireRepo(c.req.param('id')), processes))
  })

  app.get('/api/projects/:id/doc', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    const rel = c.req.query('path') ?? ''
    if (!/\.(md|mdx|markdown)$/i.test(rel))
      throw new HttpError(400, 'Only markdown files can be read')
    const file = safeJoin(worktree.path, rel)
    if (statSync(file).size > MAX_DOC_BYTES) throw new HttpError(400, 'File is too large to render')
    return c.json({ path: rel, content: readFileSync(file, 'utf8') })
  })

  app.get('/api/projects/:id/file', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    const rel = c.req.query('path') ?? ''
    const type = IMAGE_TYPES[extname(rel).toLowerCase()]
    if (!type) throw new HttpError(400, 'Only images can be served')
    const file = safeJoin(worktree.path, rel)
    return c.body(readFileSync(file), 200, {
      'Content-Type': type,
      // SVGs can carry scripts; this keeps them inert even when opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    })
  })

  app.post('/api/projects/:id/run', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    return c.json({ runs: await startServices(repo, worktree.path, body.service) })
  })

  app.post('/api/projects/:id/stop', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    const targets = processes
      .list({ projectId: repo.id, worktree: worktree.path })
      .filter((info) => isActive(info) && (!body.service || info.name === body.service))
    await Promise.all(targets.map((info) => processes.stop(info.id)))
    return c.json({ stopped: targets.map((info) => info.id) })
  })

  app.post('/api/projects/:id/restart', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    const running = processes
      .list({ projectId: repo.id, worktree: worktree.path })
      .filter(
        (info) =>
          info.kind === 'service' &&
          isActive(info) &&
          (!body.service || info.name === body.service),
      )
    if (running.length === 0) throw new HttpError(400, 'Nothing is running to restart')
    const ports = Object.fromEntries(running.map((info) => [info.name, info.port]))
    await Promise.all(running.map((info) => processes.stop(info.id)))
    // Services are resolved again, so edits to hub.config.json apply; only those that were running start.
    const runs = await startServices(
      repo,
      worktree.path,
      running.map((info) => info.name),
      ports,
    )
    return c.json({ runs })
  })

  app.post('/api/projects/:id/install', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    return c.json({ steps: await runSetup(repo, worktree.path, Boolean(body.all)) })
  })

  app.post('/api/projects/:id/uninstall', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    const runs = processes.list({ projectId: repo.id, worktree: worktree.path }).filter(isActive)
    if (runs.some((info) => info.kind === 'setup')) {
      throw new HttpError(409, 'Setup is running for this worktree')
    }
    // Running services would hold files open in node_modules or .venv.
    await Promise.all(runs.map((info) => processes.stop(info.id)))
    const setup = resolveSetup(worktree.path, getConfig().projects[repo.relPath])
    return c.json({ removed: uninstall(worktree.path, setup) })
  })

  app.get('/api/projects/:id/branches', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    return c.json(await listBranches(worktree.path, await listWorktrees(repo.path)))
  })

  app.get('/api/projects/:id/commits', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    const skip = Number(c.req.query('skip') ?? 0) || 0
    return c.json(await listCommits(worktree.path, c.req.query('ref') ?? 'HEAD', skip))
  })

  app.get('/api/projects/:id/graph', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    return c.json(await getGraph(worktree.path, await listWorktrees(repo.path)))
  })

  app.post('/api/projects/:id/checkout', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    const target =
      typeof body.commit === 'string'
        ? { commit: body.commit }
        : typeof body.branch === 'string'
          ? { branch: body.branch }
          : null
    if (!target) throw new HttpError(400, 'Expected a branch or a commit')
    await checkout(worktree.path, await listWorktrees(repo.path), target)
    return c.json({ ok: true })
  })

  app.post('/api/projects/:id/commit', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    if (typeof body.message !== 'string') throw new HttpError(400, 'A commit message is required')
    if (body.paths !== undefined) {
      if (!Array.isArray(body.paths) || !body.paths.every((path) => typeof path === 'string')) {
        throw new HttpError(400, 'Expected a list of file paths')
      }
      return c.json({ head: await commitPaths(worktree.path, body.message, body.paths) })
    }
    return c.json({ head: await commitAll(worktree.path, body.message) })
  })

  app.get('/api/projects/:id/changes', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    return c.json(await listChanges(worktree.path))
  })

  app.get('/api/projects/:id/diff', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const worktree = await resolveWorktree(repo, c.req.query('worktree'))
    const path = c.req.query('path')
    if (!path) throw new HttpError(400, 'Expected a path')
    return c.json(await fileDiff(worktree.path, path, c.req.query('full') === '1'))
  })

  app.get('/api/activity', async (c) => {
    const projectId = c.req.query('project')
    if (projectId) requireRepo(projectId)
    return c.json(await activity.summary(activityRepos(findAllRepos(), projectId)))
  })

  app.get('/api/activity/day', async (c) => {
    const projectId = c.req.query('project')
    if (projectId) requireRepo(projectId)
    const date = c.req.query('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Expected date=YYYY-MM-DD')
    const scope = c.req.query('scope') ?? 'local'
    if (scope !== 'local' && scope !== 'pushed') throw new HttpError(400, 'Unknown scope')
    return c.json(await activity.day(activityRepos(findAllRepos(), projectId), date, scope))
  })

  app.post('/api/fetch', async (c) => {
    const { failed } = await fetcher.fetchAll(findAllRepos())
    return c.json({ fetchedAt: fetcher.current.lastFetchAt, failed })
  })

  app.post('/api/projects/:id/fetch', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    await fetchRepo(repo.path)
    return c.json({ ok: true })
  })

  app.post('/api/projects/:id/pull', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    await pull(worktree.path)
    return c.json({ ok: true })
  })

  app.post('/api/projects/:id/push', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    await push(worktree.path)
    return c.json({ ok: true })
  })

  app.post('/api/projects/:id/open', async (c) => {
    const repo = requireRepo(c.req.param('id'))
    const body = await readBody(c)
    const worktree = await resolveWorktree(repo, body.worktree)
    if (!body.target || !['vscode', 'explorer', 'terminal'].includes(body.target)) {
      throw new HttpError(400, 'Unknown open target')
    }
    try {
      openIn(body.target, worktree.path)
    } catch (error) {
      throw new HttpError(400, (error as Error).message)
    }
    return c.json({ ok: true })
  })

  app.post('/api/runs/:id/stop', async (c) => {
    const run = processes.get(c.req.param('id'))
    if (!run) throw new HttpError(404, 'Unknown run')
    await processes.stop(run.id)
    return c.json({ ok: true })
  })

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const onChange = (info: RunInfo) => {
        void stream.writeSSE({ event: 'run', data: JSON.stringify(info) })
      }
      const onFetch = (state: FetchState) => {
        void stream.writeSSE({ event: 'fetch', data: JSON.stringify(state) })
      }
      processes.on('change', onChange)
      fetcher.on('change', onFetch)
      stream.onAbort(() => {
        processes.off('change', onChange)
        fetcher.off('change', onFetch)
      })
      await stream.writeSSE({ event: 'hello', data: '{}' })
      while (!stream.aborted) {
        await stream.sleep(25_000)
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' })
      }
    }),
  )

  app.get('/api/runs/:id/logs', (c) => {
    const id = c.req.param('id')
    const backlog = processes.logs(id)
    if (!backlog) throw new HttpError(404, 'Unknown run')
    return streamSSE(c, async (stream) => {
      // Output can arrive in bursts of thousands of lines, so it's flushed in batches.
      let pending: LogLine[] = []
      let flushTimer: NodeJS.Timeout | undefined
      const onLog = (runId: string, lines: LogLine[]) => {
        if (runId !== id) return
        pending.push(...lines)
        flushTimer ??= setTimeout(() => {
          flushTimer = undefined
          const batch = pending
          pending = []
          void stream.writeSSE({ event: 'lines', data: JSON.stringify(batch) })
        }, 50)
      }
      processes.on('log', onLog)
      stream.onAbort(() => {
        processes.off('log', onLog)
        clearTimeout(flushTimer)
      })
      await stream.writeSSE({ event: 'backlog', data: JSON.stringify(backlog) })
      while (!stream.aborted) {
        await stream.sleep(25_000)
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' })
      }
    })
  })

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  if (existsSync(DIST_DIR)) {
    app.use('/*', serveStatic({ root: relative(process.cwd(), DIST_DIR) || '.' }))
  }
  app.get('*', (c) => {
    const index = join(DIST_DIR, 'index.html')
    if (!existsSync(index)) {
      return c.text(
        'The UI has not been built. Run `npm start`, or `npm run dev` for development.',
        503,
      )
    }
    return c.html(readFileSync(index, 'utf8'))
  })

  return app
}
