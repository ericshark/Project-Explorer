import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findFreePort } from './ports.ts'
import { ProcessManager } from './processes.ts'

let dir: string
let manager: ProcessManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-processes-'))
  manager = new ProcessManager(join(dir, 'pids.json'))
})
afterAll(async () => {
  await manager.stopAll()
  rmSync(dir, { recursive: true, force: true })
})

const base = () => ({ projectId: 'p', worktree: dir, kind: 'service' as const, cwd: dir })

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

describe('ProcessManager', () => {
  it('captures output and reports a failing exit', async () => {
    const run = manager.start({
      ...base(),
      name: 'fail',
      command: 'echo hello; echo oops >&2; exit 3',
    })
    const final = await manager.waitForExit(run.id)
    expect(final).toMatchObject({ status: 'failed', exitCode: 3 })
    const text = manager.logs(run.id)!.map((line) => `${line.stream}:${line.text}`)
    expect(text).toContain('out:hello')
    expect(text).toContain('err:oops')
  })

  it('picks up a URL printed by the process', async () => {
    const run = manager.start({
      ...base(),
      name: 'url',
      command: "printf '  \\033[32mLocal:\\033[0m http://0.0.0.0:3000/\\n'",
    })
    await manager.waitForExit(run.id)
    expect(manager.get(run.id)?.url).toBe('http://localhost:3000/')
  })

  it('stops the whole process group, including background children', async () => {
    const run = manager.start({ ...base(), name: 'group', command: 'sleep 30 & sleep 30; wait' })
    const pgid = manager['runs'].get(run.id)!.pgid
    expect(groupAlive(pgid)).toBe(true)
    await manager.stop(run.id)
    expect(manager.get(run.id)?.status).toBe('exited')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(groupAlive(pgid)).toBe(false)
  })

  it('marks a service running once its port accepts connections', async () => {
    const port = await findFreePort(43100)
    const run = manager.start({
      ...base(),
      name: 'server',
      port,
      command: `node -e "require('net').createServer().listen(${port}, '127.0.0.1')"`,
    })
    expect(run.status).toBe('starting')
    await new Promise<void>((resolve) => {
      const onChange = (info: { id: string; status: string }) => {
        if (info.id === run.id && info.status === 'running') {
          manager.off('change', onChange)
          resolve()
        }
      }
      manager.on('change', onChange)
    })
    await manager.stop(run.id)
  })

  it('keeps only the latest finished run per service', async () => {
    const first = manager.start({ ...base(), name: 'repeat', command: 'true' })
    await manager.waitForExit(first.id)
    const second = manager.start({ ...base(), name: 'repeat', command: 'true' })
    await manager.waitForExit(second.id)
    expect(manager.get(first.id)).toBeUndefined()
    expect(manager.get(second.id)).toBeDefined()
  })
})

describe('findFreePort', () => {
  let blocker: Server
  let taken: number

  beforeAll(async () => {
    taken = await findFreePort(43200)
    blocker = createServer().listen(taken, '127.0.0.1')
    await new Promise((resolve) => blocker.once('listening', resolve))
  })
  afterAll(() => new Promise((resolve) => blocker.close(resolve)))

  it('skips ports that are bound or reserved', async () => {
    const next = await findFreePort(taken)
    expect(next).toBeGreaterThan(taken)
    expect(await findFreePort(taken, new Set([next]))).toBeGreaterThan(next)
  })
})
