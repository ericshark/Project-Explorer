import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPrivateEnv } from './env.ts'

const dirs: string[] = []
function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'project-explorer-env-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('private environment', () => {
  it('allows a missing optional file', () => {
    expect(() => loadPrivateEnv(join(temporaryDir(), 'missing.env'))).not.toThrow()
  })

  it('loads values while preserving shell overrides', () => {
    vi.stubEnv('PROJECT_EXPLORER_TEST_VALUE', undefined)
    vi.stubEnv('HUB_PORT', '4799')
    const path = join(temporaryDir(), 'private.env')
    writeFileSync(path, 'PROJECT_EXPLORER_TEST_VALUE=local\nHUB_PORT=4700\n')
    loadPrivateEnv(path)
    expect(process.env.PROJECT_EXPLORER_TEST_VALUE).toBe('local')
    expect(process.env.HUB_PORT).toBe('4799')
  })

  it('reports read errors other than a missing file', () => {
    expect(() => loadPrivateEnv(temporaryDir())).toThrow()
  })

  it('selects the private configuration before resolving project roots', async () => {
    vi.stubEnv('HUB_CONFIG', undefined)
    const dir = temporaryDir()
    const configPath = join(dir, 'hub.local.json')
    const envPath = join(dir, 'private.env')
    writeFileSync(configPath, JSON.stringify({ roots: [dir], projects: {}, ignore: [] }))
    writeFileSync(envPath, `HUB_CONFIG=${configPath}\n`)
    loadPrivateEnv(envPath)
    const { CONFIG_PATH, getConfig } = await import('./config.ts')
    expect(CONFIG_PATH).toBe(configPath)
    expect(getConfig().roots).toEqual([dir])
  })
})
