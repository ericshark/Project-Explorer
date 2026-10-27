import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectServices,
  detectSetup,
  envWarnings,
  installedPaths,
  missingSetup,
  renderTemplate,
  uninstall,
  usesPort,
} from './services.ts'

let dir: string

function writePackage(scripts: Record<string, string>, deps: Record<string, string> = {}) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts, devDependencies: deps }))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-services-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('detectServices', () => {
  it('passes the port to Vite through npm with --', () => {
    writePackage({ dev: 'vite' }, { vite: '8' })
    expect(detectServices(dir)).toEqual([
      {
        name: 'dev',
        command: 'npm run dev -- --port {port} --strictPort',
        defaultPort: 5173,
        open: true,
      },
    ])
  })

  it('passes args to pnpm scripts without --', () => {
    writePackage({ dev: 'vite' }, { vite: '8' })
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    expect(detectServices(dir)[0].command).toBe('pnpm run dev --port {port} --strictPort')
  })

  it('gives Next.js its port through PORT', () => {
    writePackage({ dev: 'next dev' }, { next: '16' })
    expect(detectServices(dir)[0]).toMatchObject({
      command: 'npm run dev',
      env: { PORT: '{port}' },
      defaultPort: 3000,
    })
  })

  it('runs unknown dev scripts as-is, without a port', () => {
    writePackage({ dev: 'node server.js' })
    expect(detectServices(dir)).toEqual([{ name: 'dev', command: 'npm run dev' }])
  })

  it('returns nothing without a dev script', () => {
    writePackage({ test: 'node --test' })
    expect(detectServices(dir)).toEqual([])
  })
})

describe('setup detection', () => {
  it('needs an install until node_modules exists', () => {
    writePackage({ dev: 'vite' })
    const setup = detectSetup(dir)
    expect(missingSetup(dir, setup)).toEqual(['install'])
    mkdirSync(join(dir, 'node_modules'))
    expect(missingSetup(dir, setup)).toEqual([])
  })

  it('warns about a missing .env next to an .env.example', () => {
    mkdirSync(join(dir, 'backend'))
    writeFileSync(join(dir, 'backend/.env.example'), 'KEY=')
    expect(envWarnings(dir, [{ name: 'api', cwd: 'backend', command: 'x' }])).toEqual([
      'backend/.env is missing (see backend/.env.example)',
    ])
    writeFileSync(join(dir, 'backend/.env'), 'KEY=1')
    expect(envWarnings(dir, [{ name: 'api', cwd: 'backend', command: 'x' }])).toEqual([])
  })
})

describe('renderTemplate', () => {
  const ports = { backend: 8001, frontend: 5174, docker: null }

  it('fills its own and sibling ports', () => {
    expect(renderTemplate('vite --port {port}', ports, 'frontend')).toBe('vite --port 5174')
    expect(renderTemplate('http://localhost:{ports.backend}', ports, 'frontend')).toBe(
      'http://localhost:8001',
    )
  })

  it('refuses placeholders without a port', () => {
    expect(() => renderTemplate('{port}', ports, 'docker')).toThrow(/docker/)
    expect(() => renderTemplate('{ports.missing}', ports, 'frontend')).toThrow(/missing/)
  })

  it('detects whether a service uses a port anywhere', () => {
    expect(usesPort({ name: 'a', command: 'npm run dev', env: { PORT: '{port}' } })).toBe(true)
    expect(usesPort({ name: 'b', command: 'docker compose up' })).toBe(false)
  })
})

describe('uninstall', () => {
  it('deletes the installed setup outputs and nothing else', () => {
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{}')
    const setup = [
      { name: 'install', command: 'npm install', creates: 'node_modules' },
      { name: 'py', command: 'python3 -m venv .venv', creates: '.venv' },
    ]
    expect(installedPaths(dir, setup)).toEqual(['node_modules'])
    expect(uninstall(dir, setup)).toEqual(['node_modules'])
    expect(installedPaths(dir, setup)).toEqual([])
    expect(missingSetup(dir, setup)).toEqual(['install', 'py'])
    expect(readdirSync(dir)).toEqual(['package.json'])
  })

  it('refuses a path that escapes the worktree', () => {
    const outside = mkdtempSync(join(tmpdir(), 'hub-outside-'))
    try {
      const setup = [{ name: 'bad', command: 'true', creates: `../${basename(outside)}` }]
      expect(() => uninstall(dir, setup)).toThrow(/outside/)
      expect(existsSync(outside)).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
