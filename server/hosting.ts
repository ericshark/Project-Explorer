import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import type { HostingCatalog, HostingGuide, HostingGuideSummary } from '../shared/types.ts'
import { HttpError, safeJoin } from './security.ts'

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url))
const MAX_BYTES = 2 * 1024 * 1024
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
interface Entry extends HostingGuideSummary {
  file: string
  directory: string
}

function readText(file: string): string {
  const stat = statSync(file)
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw new HttpError(400, 'Guide is too large or is not a file')
  return readFileSync(file, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCatalog(raw: unknown, directory: string, personal: boolean): Entry[] {
  if (!Array.isArray(raw)) throw new Error('Invalid catalog')
  const ids = new Set<string>()
  return raw.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      !['id', 'title', 'description', 'category', 'cost', 'file'].every(
        (key) => typeof entry[key] === 'string' && entry[key].length > 0,
      ) ||
      !ID.test(entry.id as string) ||
      ids.has(entry.id as string) ||
      !Number.isFinite(entry.order) ||
      !Array.isArray(entry.providers) ||
      !entry.providers.every((p) => typeof p === 'string') ||
      !Array.isArray(entry.projects) ||
      !entry.projects.every(
        (p) => isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string',
      ) ||
      !/\.md$/i.test(entry.file as string)
    )
      throw new Error('Invalid catalog entry')
    ids.add(entry.id as string)
    // Copy only the documented fields; catalog paths never leave the server.
    return {
      id: entry.id as string,
      title: entry.title as string,
      description: entry.description as string,
      category: entry.category as string,
      order: entry.order as number,
      projects: entry.projects.map((p) => ({ id: p.id as string, name: p.name as string })),
      providers: entry.providers as string[],
      cost: entry.cost as string,
      file: entry.file as string,
      directory,
      private: personal,
    }
  })
}

export class HostingStore {
  private readonly repository: string

  constructor(repository = REPOSITORY) {
    this.repository = repository
  }

  private entries(): { entries: Entry[]; warnings: string[] } {
    const load = (directory: string, personal: boolean) => {
      // Check both the directory and its files: neither may escape via a symlink.
      const root = safeJoin(this.repository, directory)
      const file = safeJoin(root, 'catalog.json')
      return parseCatalog(JSON.parse(readText(file)), root, personal)
    }
    const entries = load('docs/hosting', false)
    const warnings: string[] = []
    if (existsSync(join(this.repository, '.hosting'))) {
      try {
        const personal = load('.hosting', true)
        if (personal.some((p) => entries.some((g) => g.id === p.id)))
          throw new Error('Duplicate guide ID')
        entries.push(...personal)
      } catch {
        // A bad local catalog must not hide the reusable guides or expose local paths.
        warnings.push('Personal hosting guides could not be loaded. Check .hosting/catalog.json.')
      }
    }
    entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    return { entries, warnings }
  }

  catalog(): HostingCatalog {
    const { entries, warnings } = this.entries()
    return {
      guides: entries.map(({ file: _file, directory: _directory, ...guide }) => guide),
      warnings,
    }
  }

  guide(id: string): HostingGuide {
    if (!ID.test(id)) throw new HttpError(404, 'Hosting guide not found')
    const entry = this.entries().entries.find((guide) => guide.id === id)
    if (!entry) throw new HttpError(404, 'Hosting guide not found')
    const { file, directory, ...guide } = entry
    return { ...guide, content: readText(safeJoin(directory, file)) }
  }
}

export function hostingRoutes(store = new HostingStore()) {
  const app = new Hono()
  app.onError((error, c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(
      { error: error instanceof HttpError ? error.message : 'Unable to read hosting guides' },
      error instanceof HttpError ? error.status : 500,
    )
  })
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/', (c) => c.json(store.catalog()))
  app.get('/:guideId', (c) => c.json(store.guide(c.req.param('guideId'))))
  return app
}
