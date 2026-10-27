import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { getConfig, type ProjectOverride } from './config.ts'
import { attentionItems, getGitInfo, getRemoteUrl, listWorktrees } from './git.ts'
import type { ProcessManager } from './processes.ts'
import { HttpError } from './security.ts'
import {
  envWarnings,
  installedPaths,
  missingSetup,
  readPackageJson,
  resolveServices,
  resolveSetup,
} from './services.ts'
import type { ProjectDetail, ProjectSummary, WorktreeInfo, WorktreeRef } from '../shared/types.ts'

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'venv', '__pycache__', 'target'])
const MAX_DEPTH = 4

export interface Repo {
  id: string
  root: string
  relPath: string
  path: string
}

export function toProjectId(relPath: string): string {
  return relPath.split('/').join('--')
}

/**
 * Finds git repos under `root`. Descent stops at the first `.git` directory, so nested
 * worktrees (e.g. `.claude/worktrees/*`, which are dot-dirs anyway) never show up as projects.
 */
export function findRepos(root: string, ignore: string[] = []): Repo[] {
  const repos: Repo[] = []
  const walk = (dir: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const relPath = relative(root, dir)
    // An ignored path hides that repo, or every repo inside that folder.
    if (relPath && ignore.includes(relPath)) return
    if (entries.some((entry) => entry.name === '.git' && entry.isDirectory())) {
      if (relPath) repos.push({ id: toProjectId(relPath), root, relPath, path: dir })
      return
    }
    if (depth >= MAX_DEPTH) return
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), depth + 1)
    }
  }
  walk(root, 0)
  return repos.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export function findAllRepos(): Repo[] {
  const config = getConfig()
  return config.roots
    .flatMap((root) => findRepos(root, config.ignore))
    .filter((repo) => !config.projects[repo.relPath]?.hidden)
}

export function findRepo(id: string): Repo | undefined {
  return findAllRepos().find((repo) => repo.id === id)
}

function overrideFor(repo: Repo): ProjectOverride | undefined {
  return getConfig().projects[repo.relPath]
}

export function projectName(repo: Repo): string {
  return overrideFor(repo)?.name ?? basename(repo.path)
}

/** Lists the directories one level down that aren't hidden or build output. */
function childDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function detectStack(dir: string): string[] {
  const dirs = [dir, ...childDirs(dir).map((name) => join(dir, name))]
  const deps = new Set<string>()
  let python = ''
  let hasPython = false
  let hasTypeScript = false
  for (const d of dirs) {
    const pkg = readPackageJson(d)
    if (pkg) {
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        deps.add(name)
      }
    }
    if (existsSync(join(d, 'tsconfig.json'))) hasTypeScript = true
    for (const file of ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt']) {
      const text = readText(join(d, file))
      if (text) {
        hasPython = true
        python += text.toLowerCase()
      }
    }
  }

  const stack: string[] = []
  if (deps.has('next')) stack.push('Next.js')
  if (deps.has('vite')) stack.push('Vite')
  if (deps.has('react')) stack.push('React')
  if (deps.has('three')) stack.push('Three.js')
  if (deps.has('tailwindcss')) stack.push('Tailwind')
  if (hasTypeScript || deps.has('typescript')) stack.push('TypeScript')
  if (python.includes('fastapi')) stack.push('FastAPI')
  if (python.includes('django')) stack.push('Django')
  if (python.includes('flask')) stack.push('Flask')
  if (hasPython) stack.push('Python')
  if (deps.size > 0 && !deps.has('next') && !deps.has('vite')) stack.push('Node')
  if (
    ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'].some((f) =>
      existsSync(join(dir, f)),
    )
  ) {
    stack.push('Docker')
  }
  return stack
}

const JS_STACK = ['Next.js', 'Vite', 'React', 'Node', 'TypeScript']

/**
 * Puts a project in exactly one bucket, so each commit is counted once in the by-stack chart.
 * A Python backend with a JS frontend is its own bucket; otherwise the web framework wins.
 */
export function stackCategory(stack: string[]): string {
  const has = (name: string) => stack.includes(name)
  const python = has('Python')
  const js = JS_STACK.some(has)
  if (python && js) return 'Full-stack (Python + JS)'
  if (has('Next.js')) return 'Next.js'
  if (has('Vite')) return has('React') ? 'Vite + React' : 'Vite'
  if (python) return 'Python'
  if (js) return 'Node'
  return 'Other'
}

/** First prose paragraph of a README, skipping headings, badges, HTML, code and diagrams. */
export function readmeSummary(markdown: string): string | null {
  const paragraphs = markdown.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/)
  for (const raw of paragraphs) {
    const text = raw.trim()
    if (!text || /^(#|<|!\[|\[!\[|>|\||-{3,}|[-*+] |\d+\. )/.test(text)) continue
    const plain = text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (plain.length < 20) continue
    return plain.length > 240 ? `${plain.slice(0, 237).trimEnd()}…` : plain
  }
  return null
}

function describe(dir: string, override?: ProjectOverride): string | null {
  if (override?.description) return override.description
  const fromPackage = readPackageJson(dir)?.description
  if (fromPackage) return fromPackage
  return readmeSummary(readText(join(dir, 'README.md')))
}

function isMarkdown(name: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(name)
}

/** README first, then other top-level docs, then docs/**, then READMEs one level down. */
export function listDocs(dir: string): string[] {
  const top = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isMarkdown(e.name))
    .map((e) => e.name)
    .sort((a, b) => {
      const rank = (name: string) => (/^readme\./i.test(name) ? 0 : 1)
      return rank(a) - rank(b) || a.localeCompare(b)
    })

  const docsDir: string[] = []
  const walkDocs = (rel: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${entry.name}`
      if (entry.isFile() && isMarkdown(entry.name)) docsDir.push(child)
      else if (entry.isDirectory() && depth < 3 && !entry.name.startsWith('.'))
        walkDocs(child, depth + 1)
    }
  }
  walkDocs('docs', 1)

  const nested = childDirs(dir)
    .filter((name) => name !== 'docs')
    .map((name) => `${name}/README.md`)
    .filter((rel) => existsSync(join(dir, rel)))

  return [...top, ...docsDir, ...nested]
}

export async function buildWorktreeInfo(
  repo: Repo,
  worktree: WorktreeRef,
  processes: ProcessManager,
): Promise<WorktreeInfo> {
  const override = overrideFor(repo)
  const services = resolveServices(worktree.path, override)
  const setup = resolveSetup(worktree.path, override)
  return {
    ...worktree,
    git: await getGitInfo(worktree.path),
    services,
    setup,
    missing: missingSetup(worktree.path, setup),
    installed: installedPaths(worktree.path, setup),
    envWarnings: envWarnings(worktree.path, services),
    docs: listDocs(worktree.path),
    runs: processes.list({ projectId: repo.id, worktree: worktree.path }),
  }
}

export async function buildSummary(repo: Repo, processes: ProcessManager): Promise<ProjectSummary> {
  const override = overrideFor(repo)
  const [git, githubUrl, worktrees] = await Promise.all([
    getGitInfo(repo.path),
    getRemoteUrl(repo.path),
    listWorktrees(repo.path),
  ])
  const services = resolveServices(repo.path, override)
  const relDir = dirname(repo.relPath)
  const infos = await Promise.all(worktrees.map((wt) => (wt.isMain ? git : getGitInfo(wt.path))))
  const uncommitted = worktrees
    .map((wt, index) => ({
      path: wt.path,
      isMain: wt.isMain,
      branch: wt.branch,
      dirty: infos[index].dirty,
    }))
    .filter((wt) => wt.dirty > 0)
  const stack = detectStack(repo.path)
  return {
    id: repo.id,
    name: projectName(repo),
    relPath: repo.relPath,
    group: relDir === '.' ? '' : relDir,
    path: repo.path,
    description: describe(repo.path, override),
    stack,
    githubUrl,
    git,
    worktrees,
    serviceNames: services.map((service) => service.name),
    hasPage: services.some((service) => service.open || service.url),
    needsInstall: missingSetup(repo.path, resolveSetup(repo.path, override)).length > 0,
    uncommitted,
    attention: await attentionItems(repo.path, worktrees, infos),
    stackCategory: override?.stackCategory ?? stackCategory(stack),
    runs: processes.list({ projectId: repo.id }),
  }
}

export async function buildDetail(repo: Repo, processes: ProcessManager): Promise<ProjectDetail> {
  const summary = await buildSummary(repo, processes)
  return {
    ...summary,
    worktrees: await Promise.all(
      summary.worktrees.map((wt) => buildWorktreeInfo(repo, wt, processes)),
    ),
  }
}

export async function resolveWorktree(repo: Repo, path: string | undefined) {
  const worktrees = await listWorktrees(repo.path)
  const match = path ? worktrees.find((wt) => wt.path === path) : worktrees.find((wt) => wt.isMain)
  if (!match) throw new HttpError(404, 'Unknown worktree for this project')
  return match
}
