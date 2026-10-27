import { execFile } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { git, gitOrThrow } from './git.ts'
import { HttpError } from './security.ts'
import type { ChangedFile, ChangeStatus, DiffHunk, DiffLine, FileDiff } from '../shared/types.ts'

const execFileAsync = promisify(execFile)

/** git's well-known empty tree, which stands in for HEAD in a repo with no commits yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Untracked files bigger than this are listed without a line count. */
const MAX_COUNTED_BYTES = 256 * 1024
const MAX_DIFF_LINES = 5000
const MAX_DIFF_BYTES = 8 * 1024 * 1024
/** Enough context to show a whole file. */
const FULL_CONTEXT = 100_000

function statusOf(xy: string): ChangeStatus {
  const [index, tree] = xy
  if (index === 'R' || tree === 'R') return 'renamed'
  if (index === 'A') return 'added'
  if (index === 'D' || tree === 'D') return 'deleted'
  if (index === 'T' || tree === 'T') return 'typechange'
  return 'modified'
}

interface StatusEntry {
  path: string
  origPath: string | null
  status: ChangeStatus
}

/** Parses `git status --porcelain=v2 -z`; ignored files and branch headers are skipped. */
export function parseStatusEntries(out: string): StatusEntry[] {
  const fields = out.split('\0')
  const entries: StatusEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (field.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const parts = field.split(' ')
      entries.push({ path: parts.slice(8).join(' '), origPath: null, status: statusOf(parts[1]) })
    } else if (field.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path, then the original path as its own field.
      const parts = field.split(' ')
      entries.push({
        path: parts.slice(9).join(' '),
        origPath: fields[++i] ?? null,
        status: statusOf(parts[1]),
      })
    } else if (field.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      entries.push({
        path: field.split(' ').slice(10).join(' '),
        origPath: null,
        status: 'conflicted',
      })
    } else if (field.startsWith('? ')) {
      entries.push({ path: field.slice(2), origPath: null, status: 'untracked' })
    }
  }
  return entries
}

interface Numstat {
  additions: number
  deletions: number
  binary: boolean
}

/** Parses `git diff --numstat -z`, keyed by the new path. Binary files report `-`. */
export function parseNumstat(out: string): Map<string, Numstat> {
  const stats = new Map<string, Numstat>()
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i])
    if (!match) continue
    const binary = match[1] === '-'
    // A rename has an empty path here, followed by the old and new paths as separate fields.
    const path = match[3] === '' ? fields[(i += 2)] : match[3]
    stats.set(path, {
      additions: binary ? 0 : Number(match[1]),
      deletions: binary ? 0 : Number(match[2]),
      binary,
    })
  }
  return stats
}

function countUntracked(worktree: string, path: string): Numstat {
  const none = { additions: 0, deletions: 0, binary: false }
  try {
    const file = join(worktree, path)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.size > MAX_COUNTED_BYTES) return none
    const data = readFileSync(file)
    if (data.subarray(0, 8000).includes(0)) return { ...none, binary: true }
    if (data.length === 0) return none
    const newlines = data.reduce((n, byte) => n + (byte === 10 ? 1 : 0), 0)
    return { ...none, additions: newlines + (data.at(-1) === 10 ? 0 : 1) }
  } catch {
    return none
  }
}

async function diffBase(worktree: string): Promise<string> {
  const head = await git(worktree, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  return head ? 'HEAD' : EMPTY_TREE
}

/** Every modified, added, deleted, renamed and untracked file in a checkout. */
export async function listChanges(worktree: string): Promise<ChangedFile[]> {
  const [status, base] = await Promise.all([
    gitOrThrow(worktree, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    diffBase(worktree),
  ])
  const entries = parseStatusEntries(status)
  const numstat = parseNumstat(
    (await git(worktree, ['diff', '--numstat', '-z', '-M', '--no-ext-diff', base])) ?? '',
  )
  return entries
    .map((entry) => {
      const stat =
        entry.status === 'untracked'
          ? countUntracked(worktree, entry.path)
          : (numstat.get(entry.path) ?? { additions: 0, deletions: 0, binary: false })
      return { ...entry, ...stat }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function parseUnifiedDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[2])
      hunk = { oldStart: oldNo, newStart: newNo, lines: [] }
      hunks.push(hunk)
    } else if (line.startsWith('diff --git ')) {
      hunk = null
    } else if (hunk) {
      const kind = line[0]
      let parsed: DiffLine
      if (kind === '+') parsed = { kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ }
      else if (kind === '-')
        parsed = { kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null }
      else if (kind === ' ') {
        parsed = { kind: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }
      } else continue // "\ No newline at end of file"
      hunk.lines.push(parsed)
    }
  }
  return hunks
}

/** Runs a diff command, where exit code 1 ("there are differences") is a normal result. */
async function diffOutput(cwd: string, args: string[]): Promise<{ text: string; cut: boolean }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: MAX_DIFF_BYTES })
    return { text: stdout, cut: false }
  } catch (error) {
    const { stdout, code } = error as { stdout?: string; code?: number | string }
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { text: stdout ?? '', cut: true }
    if (code === 1 && stdout !== undefined) return { text: stdout, cut: false }
    throw new HttpError(400, 'Could not read the diff')
  }
}

function findChange(changes: ChangedFile[], path: string): ChangedFile {
  const file = changes.find((change) => change.path === path)
  if (!file) throw new HttpError(404, `"${path}" has no changes`)
  return file
}

/** The diff of one changed file against HEAD; `path` must be one `listChanges` reported. */
export async function fileDiff(worktree: string, path: string, full: boolean): Promise<FileDiff> {
  const file = findChange(await listChanges(worktree), path)
  if (file.binary) return { path, hunks: [], binary: true, truncated: false }

  const context = `-U${full ? FULL_CONTEXT : 3}`
  const flags = ['--no-color', '--no-ext-diff', '--no-textconv', context]
  const { text, cut } =
    file.status === 'untracked'
      ? await diffOutput(worktree, ['diff', '--no-index', ...flags, '--', '/dev/null', path])
      : await diffOutput(worktree, [
          '--literal-pathspecs',
          'diff',
          ...flags,
          '-M',
          await diffBase(worktree),
          '--',
          ...(file.origPath ? [file.origPath, path] : [path]),
        ])

  if (/^Binary files /m.test(text)) return { path, hunks: [], binary: true, truncated: false }
  const hunks = parseUnifiedDiff(text)
  let remaining = MAX_DIFF_LINES
  let truncated = cut
  for (const hunk of hunks) {
    if (hunk.lines.length > remaining) {
      hunk.lines.length = remaining
      truncated = true
    }
    remaining -= hunk.lines.length
  }
  return { path, hunks: hunks.filter((hunk) => hunk.lines.length > 0), binary: false, truncated }
}

/**
 * Commits only `paths` (each must be a file `listChanges` reported), leaving every other change,
 * staged or not, where it was. Returns the short hash.
 */
export async function commitPaths(
  worktree: string,
  message: string,
  paths: string[],
): Promise<string> {
  if (!message.trim()) throw new HttpError(400, 'A commit message is required')
  if (paths.length === 0) throw new HttpError(400, 'Select at least one file to commit')
  const changes = await listChanges(worktree)
  const files = [...new Set(paths)].map((path) => findChange(changes, path))
  // A rename's old path is already gone from the index, so only `commit` needs to name it.
  const specs = files.flatMap((file) => (file.origPath ? [file.path, file.origPath] : [file.path]))
  await gitOrThrow(worktree, [
    '--literal-pathspecs',
    'add',
    '-A',
    '--',
    ...files.map((file) => file.path),
  ])
  await gitOrThrow(worktree, [
    '--literal-pathspecs',
    'commit',
    '--only',
    '-m',
    message.trim(),
    '--',
    ...specs,
  ])
  return (await gitOrThrow(worktree, ['rev-parse', '--short', 'HEAD'])).trim()
}
