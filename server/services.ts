import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ServiceDef, SetupStep } from '../shared/types.ts'
import type { ProjectOverride } from './config.ts'
import { safeJoin } from './security.ts'

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

interface PackageJson {
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return null
  }
}

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/** Builds `<pm> run <script> <args>`; npm is the only one that needs `--` before script args. */
function runScript(pm: PackageManager, script: string, args = ''): string {
  const separator = pm === 'npm' && args ? ' --' : ''
  return `${pm} run ${script}${separator}${args ? ` ${args}` : ''}`
}

function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])
}

/** Guesses the dev server for a worktree whose root package.json has a `dev` script. */
export function detectServices(worktree: string): ServiceDef[] {
  const pkg = readPackageJson(worktree)
  const devScript = pkg?.scripts?.dev
  if (!pkg || !devScript) return []
  const pm = detectPackageManager(worktree)

  if (hasDependency(pkg, 'next') || devScript.startsWith('next')) {
    // `next dev` reads PORT, which avoids passing flags through the package manager.
    return [
      {
        name: 'dev',
        command: runScript(pm, 'dev'),
        defaultPort: 3000,
        env: { PORT: '{port}' },
        open: true,
      },
    ]
  }
  if (hasDependency(pkg, 'vite') || devScript.startsWith('vite')) {
    return [
      {
        name: 'dev',
        command: runScript(pm, 'dev', '--port {port} --strictPort'),
        defaultPort: 5173,
        open: true,
      },
    ]
  }
  return [{ name: 'dev', command: runScript(pm, 'dev') }]
}

export function detectSetup(worktree: string): SetupStep[] {
  if (!readPackageJson(worktree)) return []
  const pm = detectPackageManager(worktree)
  return [{ name: 'install', command: `${pm} install`, creates: 'node_modules' }]
}

export function resolveServices(worktree: string, override?: ProjectOverride): ServiceDef[] {
  return override?.services ?? detectServices(worktree)
}

export function resolveSetup(worktree: string, override?: ProjectOverride): SetupStep[] {
  return override?.setup ?? detectSetup(worktree)
}

export function missingSetup(worktree: string, setup: SetupStep[]): string[] {
  return setup
    .filter((step) => step.creates && !existsSync(join(worktree, step.creates)))
    .map((step) => step.name)
}

export function installedPaths(worktree: string, setup: SetupStep[]): string[] {
  return [
    ...new Set(
      setup.flatMap((step) =>
        step.creates && existsSync(join(worktree, step.creates)) ? [step.creates] : [],
      ),
    ),
  ]
}

/** Deletes what the setup steps installed; each path must resolve inside the worktree. */
export function uninstall(worktree: string, setup: SetupStep[]): string[] {
  const paths = installedPaths(worktree, setup)
  const targets = paths.map((rel) => safeJoin(worktree, rel))
  for (const target of targets) rmSync(target, { recursive: true, force: true })
  return paths
}

export function envWarnings(worktree: string, services: ServiceDef[]): string[] {
  const dirs = new Set(['', ...services.map((service) => service.cwd ?? '')])
  const warnings: string[] = []
  for (const dir of dirs) {
    const base = join(worktree, dir)
    if (existsSync(join(base, '.env.example')) && !existsSync(join(base, '.env'))) {
      warnings.push(
        `${dir ? `${dir}/` : ''}.env is missing (see ${dir ? `${dir}/` : ''}.env.example)`,
      )
    }
  }
  return warnings
}

export function usesPort(service: ServiceDef): boolean {
  const text = [service.command, service.url ?? '', ...Object.values(service.env ?? {})].join(' ')
  return text.includes('{port}')
}

/** Fills `{port}` and `{ports.<name>}`; unknown placeholders are an error rather than a silent blank. */
export function renderTemplate(
  template: string,
  ports: Record<string, number | null>,
  self: string,
): string {
  return template.replace(/\{(port|ports\.([\w-]+))\}/g, (_match, _key, sibling?: string) => {
    const name = sibling ?? self
    const port = ports[name]
    if (port == null) throw new Error(`No port is assigned to service "${name}"`)
    return String(port)
  })
}
