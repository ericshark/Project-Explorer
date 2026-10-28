import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostingStore, hostingRoutes } from './hosting.ts'
import { HttpError, localOnly } from './security.ts'

let root: string
const entry = (id: string, order = 10) => ({
  id,
  order,
  title: id,
  description: 'Instructions',
  category: 'Recipes',
  projects: [],
  providers: ['Vercel'],
  cost: 'See guide',
  file: `${id}.md`,
})
function catalog(directory: string, entries: unknown) {
  mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(join(root, directory, 'catalog.json'), JSON.stringify(entries))
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hosting-test-'))
  catalog('docs/hosting', [entry('shared', 100)])
  writeFileSync(join(root, 'docs/hosting/shared.md'), '# Shared\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('hosting catalog and guide reads', () => {
  it('works without local content and omits disk paths', () => {
    const result = new HostingStore(root).catalog()
    expect(result.warnings).toEqual([])
    expect(result.guides).toHaveLength(1)
    expect(result.guides[0].private).toBe(false)
    expect(JSON.stringify(result)).not.toContain('file')
    expect(JSON.stringify(result)).not.toContain(root)
  })
  it('orders local and shared guides and preserves project mappings', () => {
    catalog('.hosting', [
      { ...entry('personal', 1), projects: [{ id: 'sample--app', name: 'Sample' }] },
      entry('second', 1),
    ])
    writeFileSync(join(root, '.hosting/personal.md'), '# Personal')
    const store = new HostingStore(root)
    expect(store.catalog().guides.map((g) => g.id)).toEqual(['personal', 'second', 'shared'])
    expect(store.guide('personal')).toMatchObject({
      private: true,
      content: '# Personal',
      projects: [{ id: 'sample--app', name: 'Sample' }],
    })
  })
  it('retains shared recipes on malformed local catalogs, duplicates and collisions', () => {
    for (const bad of [
      null,
      {},
      [entry('bad'), entry('bad')],
      [entry('shared')],
      [{ ...entry('x'), order: 'wrong' }],
      [{ ...entry('x'), projects: [{}] }],
    ]) {
      catalog('.hosting', bad)
      const result = new HostingStore(root).catalog()
      expect(result.guides.map((g) => g.id)).toEqual(['shared'])
      expect(result.warnings).toHaveLength(1)
    }
    writeFileSync(join(root, '.hosting/catalog.json'), '{not json')
    expect(new HostingStore(root).catalog().warnings).toHaveLength(1)
  })
  it('does not expose unregistered markdown and reports missing registered files', () => {
    catalog('.hosting', [entry('missing')])
    const store = new HostingStore(root)
    expect(() => store.guide('missing')).toThrow('File not found')
    expect(() => store.guide('../shared')).toThrow('Hosting guide not found')
    expect(() => store.guide('unregistered')).toThrow('Hosting guide not found')
  })
  it('rejects traversal and symlinks outside the guide directory', () => {
    writeFileSync(join(root, 'secret.md'), 'secret')
    catalog('.hosting', [{ ...entry('escape'), file: '../secret.md' }])
    const store = new HostingStore(root)
    expect(() => store.guide('escape')).toThrow('Path is outside')
    catalog('.hosting', [entry('escape')])
    symlinkSync(join(root, 'secret.md'), join(root, '.hosting/escape.md'))
    expect(() => store.guide('escape')).toThrow('Path is outside')
    rmSync(join(root, '.hosting/catalog.json'))
    symlinkSync(join(root, 'secret.md'), join(root, '.hosting/catalog.json'))
    expect(store.catalog().warnings).toHaveLength(1)
  })
  it('rejects a local directory symlink outside the repository', () => {
    symlinkSync(tmpdir(), join(root, '.hosting'))
    expect(new HostingStore(root).catalog().warnings).toHaveLength(1)
  })
  it('rejects directories and oversized guide files', () => {
    catalog('.hosting', [entry('large'), entry('directory')])
    writeFileSync(join(root, '.hosting/large.md'), 'x'.repeat(2 * 1024 * 1024 + 1))
    mkdirSync(join(root, '.hosting/directory.md'))
    expect(() => new HostingStore(root).guide('large')).toThrow('too large')
    expect(() => new HostingStore(root).guide('directory')).toThrow('not a file')
  })
})

describe('read-only HTTP routes', () => {
  function app() {
    const app = new Hono()
    app.onError((err, c) =>
      c.json(
        { error: err instanceof HttpError ? err.message : 'Read failed' },
        err instanceof HttpError ? err.status : 500,
      ),
    )
    app.use('*', localOnly)
    app.route('/api/hosting', hostingRoutes(new HostingStore(root)))
    return app
  }
  const request = (path: string, method = 'GET') =>
    app().request(`http://localhost/api/hosting${path}`, {
      method,
      headers: { host: 'localhost', origin: 'http://localhost' },
    })
  it('returns catalog and detail without caching and refuses writes', async () => {
    for (const path of ['', '/shared']) {
      const res = await request(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect((await request('/unknown')).status).toBe(404)
    expect((await request('', 'POST')).status).toBe(404)
    expect(
      (await app().request('http://localhost/api/hosting', { headers: { host: 'evil.example' } }))
        .status,
    ).toBe(403)
  })
  it('does not cache failures or disclose filesystem errors', async () => {
    const missing = await request('/unknown')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    writeFileSync(join(root, 'docs/hosting/catalog.json'), 'bad json')
    const failed = await request('')
    expect(failed.status).toBe(500)
    expect(failed.headers.get('cache-control')).toBe('no-store')
    expect(await failed.json()).toEqual({ error: 'Unable to read hosting guides' })
  })
})
