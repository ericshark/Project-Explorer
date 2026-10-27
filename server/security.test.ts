import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError, localOnly, safeJoin } from './security.ts'

let root: string
let project: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-security-'))
  project = join(root, 'project')
  mkdirSync(join(project, 'docs'), { recursive: true })
  writeFileSync(join(project, 'docs/a.md'), '# A')
  writeFileSync(join(root, 'secret.md'), 'nope')
  symlinkSync(join(root, 'secret.md'), join(project, 'escape.md'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn()
  } catch (error) {
    return (error as HttpError).status
  }
}

describe('safeJoin', () => {
  it('resolves files inside the root', () => {
    expect(safeJoin(project, 'docs/a.md')).toBe(join(project, 'docs/a.md'))
  })

  it('rejects traversal, absolute paths and symlinks that escape', () => {
    expect(statusOf(() => safeJoin(project, '../secret.md'))).toBe(403)
    expect(statusOf(() => safeJoin(project, '/etc/passwd'))).toBe(400)
    expect(statusOf(() => safeJoin(project, 'escape.md'))).toBe(403)
    expect(statusOf(() => safeJoin(project, 'missing.md'))).toBe(404)
  })
})

describe('localOnly', () => {
  const app = new Hono()
  app.use('*', localOnly)
  app.all('/x', (c) => c.text('ok'))
  const call = (method: string, headers: Record<string, string>) =>
    app.request('http://localhost:4600/x', { method, headers })

  it('allows same-origin requests on loopback', async () => {
    expect((await call('GET', { host: 'localhost:4600' })).status).toBe(200)
    const post = await call('POST', { host: '127.0.0.1:4600', origin: 'http://127.0.0.1:4600' })
    expect(post.status).toBe(200)
  })

  it('blocks DNS-rebinding hosts', async () => {
    expect((await call('GET', { host: 'evil.example:4600' })).status).toBe(403)
  })

  it('blocks cross-origin and origin-less writes', async () => {
    const otherPort = await call('POST', {
      host: 'localhost:4600',
      origin: 'http://localhost:3000',
    })
    expect(otherPort.status).toBe(403)
    expect((await call('POST', { host: 'localhost:4600' })).status).toBe(403)
  })
})
