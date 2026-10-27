import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { HttpError } from './security.ts'
import type {
  AttentionItem,
  BranchCompare,
  BranchInfo,
  BranchList,
  CommitInfo,
  GitInfo,
  GraphData,
  WorktreeRef,
} from '../shared/types.ts'

const execFileAsync = promisify(execFile)

const COMMITS_PAGE = 100
const GRAPH_LIMIT = 400
const LOG_FORMAT = '--format=%H%x00%h%x00%P%x00%an%x00%ct%x00%s'

export async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/** Like `git`, but a failure becomes a 400 carrying git's own message. */
export async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const { stderr, stdout, message } = error as {
      stderr?: string
      stdout?: string
      message: string
    }
    throw new HttpError(400, (stderr || stdout || message).trim())
  }
}

const REMOTE_TIMEOUT_MS = 60_000

/**
 * For commands that talk to a remote. Prompts are disabled so a missing credential fails
 * instead of hanging the hub, and the timeout bounds an unreachable host.
 */
async function gitRemote(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: REMOTE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    // fetch, pull and push report progress and results on stderr.
    return (stdout + stderr).trim()
  } catch (error) {
    const { stderr, stdout, message, killed } = error as {
      stderr?: string
      stdout?: string
      message: string
      killed?: boolean
    }
    if (killed) throw new HttpError(400, `git ${args[0]} timed out`)
    throw new HttpError(400, (stderr || stdout || message).trim())
  }
}

export function parseWorktreeList(porcelain: string): WorktreeRef[] {
  const entries: WorktreeRef[] = []
  for (const block of porcelain.split('\n\n')) {
    const lines = block.split('\n')
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length)
    if (!path || lines.includes('bare')) continue
    const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length)
    entries.push({
      path,
      // git lists the main worktree first.
      isMain: entries.length === 0,
      branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
    })
  }
  return entries
}

export async function listWorktrees(repoPath: string): Promise<WorktreeRef[]> {
  const out = await git(repoPath, ['worktree', 'list', '--porcelain'])
  if (out === null) return [{ path: repoPath, isMain: true, branch: null }]
  // Worktrees whose directory was deleted without `git worktree prune` are skipped.
  return parseWorktreeList(out).filter((entry) => existsSync(entry.path))
}

export function parseStatus(
  porcelainV2: string,
): Pick<GitInfo, 'branch' | 'dirty' | 'ahead' | 'behind'> {
  let branch: string | null = null
  let ahead: number | null = null
  let behind: number | null = null
  let dirty = 0
  for (const line of porcelainV2.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line)
      if (match) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
    } else if (line && !line.startsWith('#')) {
      dirty++
    }
  }
  return { branch, dirty, ahead, behind }
}

export async function getGitInfo(worktreePath: string): Promise<GitInfo> {
  const [status, log] = await Promise.all([
    git(worktreePath, ['status', '--porcelain=v2', '--branch']),
    git(worktreePath, ['log', '-1', '--format=%h%x00%s%x00%ct']),
  ])
  const parsed = status
    ? parseStatus(status)
    : { branch: null, dirty: 0, ahead: null, behind: null }
  // `git log` fails in a repo with no commits yet.
  const [head, subject, committedAt] = log ? log.trim().split('\0') : []
  return {
    ...parsed,
    head: head || null,
    subject: subject ?? null,
    committedAt: committedAt ? Number(committedAt) * 1000 : null,
  }
}

/** Commits on HEAD that exist on no remote branch, for a branch that has no upstream yet. */
async function unpublishedCommits(worktreePath: string): Promise<number> {
  const out = await git(worktreePath, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  return Number(out?.trim()) || 0
}

/**
 * What needs a commit, push or pull in a repo. `infos` is `getGitInfo` for each entry of
 * `worktrees`. Repos without a remote only ever report uncommitted changes.
 */
export async function attentionItems(
  repoPath: string,
  worktrees: WorktreeRef[],
  infos: GitInfo[],
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = []
  const remote = await hasRemote(repoPath)
  await Promise.all(
    worktrees.map(async (wt, index) => {
      const { dirty, ahead, behind, branch } = infos[index]
      const base = { branch, worktree: wt.path, isMain: wt.isMain }
      if (dirty > 0) items.push({ ...base, kind: 'uncommitted', count: dirty, against: null })
      if (!remote || !branch) return
      if (ahead === null || behind === null) {
        // No upstream: its commits live only here until the branch is published.
        const count = await unpublishedCommits(wt.path)
        if (count > 0) items.push({ ...base, kind: 'unpublished', count, against: null })
        return
      }
      const upstream = (await currentUpstream(wt.path)) ?? 'upstream'
      if (ahead > 0) items.push({ ...base, kind: 'unpushed', count: ahead, against: upstream })
      if (behind > 0) items.push({ ...base, kind: 'behind', count: behind, against: upstream })
    }),
  )

  if (remote) {
    // Branches nobody has checked out can still be ahead of or behind their upstream.
    const heldBy = new Set(worktrees.flatMap((wt) => (wt.branch ? [wt.branch] : [])))
    const branches = parseBranches(
      (await git(repoPath, ['for-each-ref', BRANCH_FORMAT, 'refs/heads'])) ?? '',
    )
    for (const branch of branches) {
      if (heldBy.has(branch.name) || !branch.compare) continue
      const { ahead, behind, against } = branch.compare
      const base = { branch: branch.name, worktree: null, isMain: false }
      if (ahead > 0) items.push({ ...base, kind: 'unpushed', count: ahead, against })
      if (behind > 0) items.push({ ...base, kind: 'behind', count: behind, against })
    }
  }

  const order = { uncommitted: 0, unpushed: 1, unpublished: 2, behind: 3 }
  const where = (item: AttentionItem) => (item.isMain ? 0 : item.worktree ? 1 : 2)
  return items.sort((a, b) => order[a.kind] - order[b.kind] || where(a) - where(b))
}

export function toWebUrl(remote: string): string | null {
  const trimmed = remote.trim().replace(/\.git$/, '')
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(trimmed)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  if (/^https?:\/\//.test(trimmed)) return trimmed.replace(/\/\/[^@/]+@/, '//')
  return null
}

export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  const remote = await git(repoPath, ['config', '--get', 'remote.origin.url'])
  return remote ? toWebUrl(remote) : null
}

const BRANCH_FORMAT =
  '--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(subject)'

/** Reads `%(upstream:track,nobracket)`, e.g. "ahead 2, behind 1"; "gone" means no upstream. */
export function parseTrack(track: string, upstream: string): BranchCompare | null {
  if (!upstream || track === 'gone') return null
  return {
    against: upstream,
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
  }
}

/**
 * Finds the branch a detached HEAD came from: the newest reflog "checkout: moving from X to Y"
 * whose X is still a local branch. Hops from one commit to another are skipped.
 */
export function parsePreviousBranch(reflog: string, localBranches: Set<string>): string | null {
  for (const line of reflog.split('\n')) {
    const from = /^checkout: moving from (\S+) to /.exec(line)?.[1]
    if (from && localBranches.has(from)) return from
  }
  return null
}

/**
 * Parses `git for-each-ref` output. `compare` starts as the upstream comparison; the caller fills
 * in `checkedOutIn`, `dirty`, and (for every other branch) the comparison against the default
 * branch.
 */
export function parseBranches(out: string): BranchInfo[] {
  const branches: BranchInfo[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [refname, head, committedAt, upstream, track, subject] = line.split('\0')
    // `refs/remotes/origin/HEAD` is a pointer to the default branch, not a branch.
    if (refname.endsWith('/HEAD')) continue
    const remote = refname.startsWith('refs/remotes/')
    branches.push({
      name: refname.replace(/^refs\/(heads|remotes)\//, ''),
      remote,
      head,
      subject: subject ?? '',
      committedAt: Number(committedAt) * 1000,
      upstream: upstream || null,
      checkedOutIn: null,
      dirty: null,
      compare: remote ? null : parseTrack(track ?? '', upstream ?? ''),
    })
  }
  return branches
}

export function parseLog(out: string): CommitInfo[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, short, parents, author, committedAt, subject] = line.split('\0')
      return {
        hash,
        short,
        parents: parents ? parents.split(' ') : [],
        author,
        committedAt: Number(committedAt) * 1000,
        subject: subject ?? '',
      }
    })
}

function fullRef(branch: BranchInfo): string {
  return `${branch.remote ? 'refs/remotes' : 'refs/heads'}/${branch.name}`
}

async function readBranches(cwd: string): Promise<BranchInfo[]> {
  return parseBranches(
    await gitOrThrow(cwd, ['for-each-ref', BRANCH_FORMAT, 'refs/heads', 'refs/remotes']),
  )
}

/** Every local and remote branch, with which worktree (if any) has it and how dirty that is. */
export async function listBranches(
  worktreePath: string,
  worktrees: WorktreeRef[],
): Promise<BranchList> {
  const [branches, current] = await Promise.all([
    readBranches(worktreePath),
    getGitInfo(worktreePath),
  ])
  await Promise.all(
    branches.map(async (branch) => {
      const holder = branch.remote ? undefined : worktrees.find((wt) => wt.branch === branch.name)
      if (!holder) return
      branch.checkedOutIn = holder.path
      branch.dirty =
        holder.path === worktreePath ? current.dirty : (await getGitInfo(holder.path)).dirty
    }),
  )

  const localNames = new Set(branches.filter((b) => !b.remote).map((b) => b.name))
  const defaultBranch = await findDefaultBranch(worktreePath, localNames)
  if (defaultBranch) {
    await Promise.all(
      branches
        .filter((b) => b.remote || b.name !== defaultBranch)
        .map(async (branch) => {
          branch.compare = await compareBranches(worktreePath, defaultBranch, fullRef(branch))
        }),
    )
  }

  branches.sort(
    (a, b) =>
      Number(a.remote) - Number(b.remote) ||
      Number(b.name === current.branch) - Number(a.name === current.branch) ||
      Number(b.name === defaultBranch) - Number(a.name === defaultBranch) ||
      b.committedAt - a.committedAt,
  )
  const [head, reflog] = await Promise.all([
    git(worktreePath, ['rev-parse', 'HEAD']),
    current.branch ? null : git(worktreePath, ['reflog', '-n500', '--format=%gs']),
  ])
  return {
    current: current.branch,
    head: head?.trim() || null,
    defaultBranch,
    previousBranch: reflog ? parsePreviousBranch(reflog, localNames) : null,
    branches,
  }
}

async function findDefaultBranch(cwd: string, localNames: Set<string>): Promise<string | null> {
  const originHead = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const fromOrigin = originHead?.trim().replace(/^origin\//, '')
  if (fromOrigin && localNames.has(fromOrigin)) return fromOrigin
  return ['main', 'master'].find((name) => localNames.has(name)) ?? null
}

/** Counts commits `ref` has that local `base` doesn't (ahead) and the reverse (behind). */
async function compareBranches(
  cwd: string,
  base: string,
  ref: string,
): Promise<BranchCompare | null> {
  const out = await git(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    '--end-of-options',
    `refs/heads/${base}...${ref}`,
  ])
  const [behind, ahead] = out?.trim().split(/\s+/).map(Number) ?? []
  return out ? { against: base, ahead, behind } : null
}

/** A page of commits on `ref` (a branch name from `listBranches`, or `HEAD`). */
export async function listCommits(
  worktreePath: string,
  ref: string,
  skip = 0,
): Promise<CommitInfo[]> {
  let target = 'HEAD'
  if (ref !== 'HEAD') {
    const branch = (await readBranches(worktreePath)).find((b) => b.name === ref)
    if (!branch) throw new HttpError(404, `Unknown branch "${ref}"`)
    target = fullRef(branch)
  }
  const out = await git(worktreePath, [
    'log',
    LOG_FORMAT,
    `-n${COMMITS_PAGE}`,
    `--skip=${Math.max(0, Math.floor(skip))}`,
    '--end-of-options',
    target,
  ])
  // `git log` fails in a repo with no commits yet.
  return out ? parseLog(out) : []
}

export async function getGraph(worktreePath: string, worktrees: WorktreeRef[]): Promise<GraphData> {
  const { branches, head } = await listBranches(worktreePath, worktrees)
  const out = head
    ? await git(worktreePath, [
        'log',
        LOG_FORMAT,
        '--topo-order',
        `-n${GRAPH_LIMIT}`,
        '--branches',
        '--remotes',
        'HEAD',
      ])
    : null
  return { commits: out ? parseLog(out) : [], branches, head }
}

export type CheckoutTarget = { branch: string } | { commit: string }

/**
 * Switches a worktree to a branch or (detached) commit. Names are only ever ones `git
 * for-each-ref` reported, and commits must look like a hash, so no user text reaches git as an
 * option. Uncommitted changes block the switch so nothing is carried over or lost.
 */
export async function checkout(
  worktreePath: string,
  worktrees: WorktreeRef[],
  target: CheckoutTarget,
): Promise<void> {
  const { dirty, branch: current } = await getGitInfo(worktreePath)
  if (dirty > 0) {
    throw new HttpError(
      409,
      `Commit or discard ${dirty} uncommitted change${dirty === 1 ? '' : 's'} first`,
    )
  }

  if ('commit' in target) {
    if (!/^[0-9a-f]{4,40}$/i.test(target.commit)) throw new HttpError(400, 'Invalid commit hash')
    const hash = (
      await gitOrThrow(worktreePath, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${target.commit}^{commit}`,
      ])
    ).trim()
    await gitOrThrow(worktreePath, ['switch', '--detach', hash])
    return
  }

  const branches = await readBranches(worktreePath)
  const picked = branches.find((b) => b.name === target.branch)
  if (!picked) throw new HttpError(404, `Unknown branch "${target.branch}"`)

  // A remote branch is checked out through its local branch, created to track it if needed.
  const localName = picked.remote ? picked.name.slice(picked.name.indexOf('/') + 1) : picked.name
  const local = branches.find((b) => !b.remote && b.name === localName)
  if (local) {
    if (local.name === current) return
    const holder = worktrees.find((wt) => wt.branch === local.name && wt.path !== worktreePath)
    if (holder) throw new HttpError(409, `"${local.name}" is checked out in ${holder.path}`)
    await gitOrThrow(worktreePath, ['switch', local.name])
  } else {
    await gitOrThrow(worktreePath, ['switch', '--track', picked.name])
  }
}

export async function hasRemote(repoPath: string): Promise<boolean> {
  return Boolean((await git(repoPath, ['remote']))?.trim())
}

/** Updates every remote's branches; worktrees share them, so this runs once per repo. */
export async function fetchRepo(repoPath: string): Promise<void> {
  if (!(await hasRemote(repoPath))) return
  await gitRemote(repoPath, ['fetch', '--all', '--prune', '--quiet'])
}

async function currentUpstream(worktreePath: string): Promise<string | null> {
  const out = await git(worktreePath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  return out?.trim() || null
}

/** Fast-forwards the current branch; a diverged branch is git's error, left to a terminal. */
export async function pull(worktreePath: string): Promise<void> {
  const { branch } = await getGitInfo(worktreePath)
  if (!branch) throw new HttpError(400, 'Switch to a branch before pulling')
  if (!(await currentUpstream(worktreePath))) {
    throw new HttpError(400, `"${branch}" has no upstream branch to pull from`)
  }
  await gitRemote(worktreePath, ['pull', '--ff-only', '--quiet'])
}

/** Pushes the current branch, setting `origin` as its upstream the first time. Never forces. */
export async function push(worktreePath: string): Promise<void> {
  const { branch } = await getGitInfo(worktreePath)
  if (!branch) throw new HttpError(400, 'Switch to a branch before pushing')
  if (await currentUpstream(worktreePath)) {
    await gitRemote(worktreePath, ['push', '--quiet'])
    return
  }
  const remotes = (await git(worktreePath, ['remote']))?.split('\n') ?? []
  if (!remotes.includes('origin')) throw new HttpError(400, 'This repo has no "origin" remote')
  await gitRemote(worktreePath, ['push', '--quiet', '-u', 'origin', '--end-of-options', branch])
}

/** Stages everything (including untracked files) and commits it. */
export async function commitAll(worktreePath: string, message: string): Promise<string> {
  if (!message.trim()) throw new HttpError(400, 'A commit message is required')
  const { dirty } = await getGitInfo(worktreePath)
  if (dirty === 0) throw new HttpError(400, 'Nothing to commit')
  await gitOrThrow(worktreePath, ['add', '-A'])
  await gitOrThrow(worktreePath, ['commit', '-m', message.trim()])
  return (await gitOrThrow(worktreePath, ['rev-parse', '--short', 'HEAD'])).trim()
}
