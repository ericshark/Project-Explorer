import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  attentionItems,
  checkout,
  commitAll,
  fetchRepo,
  getGitInfo,
  listBranches,
  listCommits,
  listWorktrees,
  pull,
  push,
} from './git.ts'

let root: string
let repo: string

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commitFile(name: string, message: string) {
  writeFileSync(join(repo, name), message)
  sh(repo, 'add', '-A')
  sh(repo, 'commit', '-qm', message)
}

beforeAll(() => {
  // Keep the user's git config (signing, hooks, default branch) out of the test repos.
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  })
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-git-'))
  repo = join(root, 'repo')
  sh(root, 'init', '-qb', 'main', repo)
  commitFile('a.txt', 'first')
  sh(repo, 'branch', 'feature')
  commitFile('b.txt', 'second')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('checkout', () => {
  it('switches branches and refuses while there are uncommitted changes', async () => {
    const worktrees = await listWorktrees(repo)
    await checkout(repo, worktrees, { branch: 'feature' })
    expect((await getGitInfo(repo)).branch).toBe('feature')

    writeFileSync(join(repo, 'dirty.txt'), 'x')
    await expect(checkout(repo, worktrees, { branch: 'main' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('refuses a branch checked out in another worktree', async () => {
    const other = join(root, 'other')
    sh(repo, 'worktree', 'add', '-q', other, 'feature')
    const worktrees = await listWorktrees(repo)
    await expect(checkout(repo, worktrees, { branch: 'feature' })).rejects.toMatchObject({
      status: 409,
    })
    const { branches } = await listBranches(repo, worktrees)
    expect(branches.find((b) => b.name === 'feature')?.checkedOutIn).toBe(other)
  })

  it('creates a tracking branch for a remote branch', async () => {
    const origin = join(root, 'origin.git')
    sh(root, 'init', '-q', '--bare', origin)
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-q', 'origin', 'feature:remote-only')
    sh(repo, 'fetch', '-q', 'origin')

    await checkout(repo, await listWorktrees(repo), { branch: 'origin/remote-only' })
    expect((await getGitInfo(repo)).branch).toBe('remote-only')
    expect(sh(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/remote-only')
  })

  it('detaches at a commit and remembers the branch to go back to', async () => {
    const worktrees = await listWorktrees(repo)
    const first = sh(repo, 'rev-parse', '--short', 'HEAD~1')
    await checkout(repo, worktrees, { commit: first })
    const info = await getGitInfo(repo)
    expect(info.branch).toBeNull()
    expect(info.head).toBe(first)

    // A second hop between commits still leads back to main.
    await checkout(repo, worktrees, { commit: sh(repo, 'rev-parse', 'main') })
    const list = await listBranches(repo, await listWorktrees(repo))
    expect(list.current).toBeNull()
    expect(list.previousBranch).toBe('main')
  })

  it.each([{ branch: '--orphan' }, { branch: 'x; rm -rf /' }, { commit: '--detach' }])(
    'rejects %o',
    async (target) => {
      await expect(checkout(repo, await listWorktrees(repo), target)).rejects.toMatchObject({
        status: expect.any(Number),
      })
      expect((await getGitInfo(repo)).branch).toBe('main')
    },
  )
})

describe('listBranches', () => {
  it('compares branches with the default branch', async () => {
    await checkout(repo, await listWorktrees(repo), { branch: 'feature' })
    commitFile('f1.txt', 'feature 1')
    commitFile('f2.txt', 'feature 2')
    const list = await listBranches(repo, await listWorktrees(repo))
    expect(list.defaultBranch).toBe('main')
    expect(list.previousBranch).toBeNull()
    const feature = list.branches.find((b) => b.name === 'feature')
    expect(feature?.compare).toEqual({ against: 'main', ahead: 2, behind: 1 })
    // main has no upstream here, so there is nothing to compare it with.
    expect(list.branches.find((b) => b.name === 'main')?.compare).toBeNull()
  })

  it('compares main with origin/main and origin/main with main', async () => {
    const origin = join(root, 'origin.git')
    sh(root, 'init', '-q', '--bare', origin)
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-qu', 'origin', 'main')
    commitFile('c.txt', 'local only')
    const { branches } = await listBranches(repo, await listWorktrees(repo))
    expect(branches.find((b) => b.name === 'main')?.compare).toEqual({
      against: 'origin/main',
      ahead: 1,
      behind: 0,
    })
    expect(branches.find((b) => b.name === 'origin/main')?.compare).toEqual({
      against: 'main',
      ahead: 0,
      behind: 1,
    })
  })
})

describe('commitAll', () => {
  it('commits tracked and untracked changes', async () => {
    writeFileSync(join(repo, 'a.txt'), 'changed')
    writeFileSync(join(repo, 'new.txt'), 'new')
    await commitAll(repo, 'Save everything')
    expect((await getGitInfo(repo)).dirty).toBe(0)
    expect((await listCommits(repo, 'main'))[0].subject).toBe('Save everything')
  })

  it('rejects an empty message or a clean tree', async () => {
    await expect(commitAll(repo, 'nothing')).rejects.toMatchObject({ status: 400 })
    writeFileSync(join(repo, 'c.txt'), 'c')
    await expect(commitAll(repo, '   ')).rejects.toMatchObject({ status: 400 })
  })
})

describe('listCommits', () => {
  it('lists a branch newest first and pages with skip', async () => {
    expect((await listCommits(repo, 'main')).map((c) => c.subject)).toEqual(['second', 'first'])
    expect((await listCommits(repo, 'feature')).map((c) => c.subject)).toEqual(['first'])
    expect((await listCommits(repo, 'main', 1)).map((c) => c.subject)).toEqual(['first'])
    await expect(listCommits(repo, 'nope')).rejects.toMatchObject({ status: 404 })
  })
})

describe('fetch, pull and push', () => {
  let origin: string
  let clone: string

  /** `repo` and `clone` both track a bare origin that has main at "second". */
  beforeEach(() => {
    origin = join(root, 'origin.git')
    clone = join(root, 'clone')
    // `-b main` makes the bare repo's HEAD point at main, so the clone checks it out.
    sh(root, 'init', '-q', '--bare', '-b', 'main', origin)
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-qu', 'origin', 'main')
    sh(root, 'clone', '-q', origin, clone)
  })

  function commitIn(dir: string, name: string, message: string) {
    writeFileSync(join(dir, name), message)
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-qm', message)
  }

  it('fetch picks up new remote commits and pull fast-forwards to them', async () => {
    commitIn(clone, 'c.txt', 'from the clone')
    sh(clone, 'push', '-q')
    expect((await getGitInfo(repo)).behind).toBe(0)

    await fetchRepo(repo)
    expect((await getGitInfo(repo)).behind).toBe(1)

    await pull(repo)
    const info = await getGitInfo(repo)
    expect(info.behind).toBe(0)
    expect(info.subject).toBe('from the clone')
  })

  it('pull refuses to merge a diverged branch', async () => {
    commitIn(clone, 'c.txt', 'remote side')
    sh(clone, 'push', '-q')
    commitFile('d.txt', 'local side')
    await fetchRepo(repo)
    await expect(pull(repo)).rejects.toMatchObject({ status: 400 })
    expect((await getGitInfo(repo)).subject).toBe('local side')
  })

  it('push sends tracked commits and publishes a new branch with an upstream', async () => {
    commitFile('c.txt', 'to push')
    await push(repo)
    expect(sh(origin, 'log', '-1', '--format=%s', 'main')).toBe('to push')

    sh(repo, 'switch', '-qc', 'topic')
    commitFile('t.txt', 'topic work')
    await push(repo)
    expect(sh(origin, 'log', '-1', '--format=%s', 'topic')).toBe('topic work')
    expect(sh(repo, 'rev-parse', '--abbrev-ref', 'topic@{u}')).toBe('origin/topic')
  })

  it('pull and push refuse a detached HEAD, and pull refuses a branch without upstream', async () => {
    sh(repo, 'switch', '-q', '--detach', 'HEAD')
    await expect(pull(repo)).rejects.toMatchObject({ status: 400 })
    await expect(push(repo)).rejects.toMatchObject({ status: 400 })

    sh(repo, 'switch', '-qc', 'local-only')
    await expect(pull(repo)).rejects.toThrow(/no upstream/)
  })

  it('fetch is a no-op without remotes', async () => {
    const lonely = join(root, 'lonely')
    sh(root, 'init', '-qb', 'main', lonely)
    await expect(fetchRepo(lonely)).resolves.toBeUndefined()
  })
})

describe('attentionItems', () => {
  async function attention() {
    const worktrees = await listWorktrees(repo)
    const infos = await Promise.all(worktrees.map((wt) => getGitInfo(wt.path)))
    return attentionItems(repo, worktrees, infos)
  }
  const summary = (items: Awaited<ReturnType<typeof attention>>) =>
    items.map((i) => [i.kind, i.branch, i.count])

  it('is empty for a clean repo and only reports uncommitted files without a remote', async () => {
    expect(await attention()).toEqual([])
    writeFileSync(join(repo, 'new.txt'), 'untracked')
    writeFileSync(join(repo, 'a.txt'), 'changed')
    expect(summary(await attention())).toEqual([['uncommitted', 'main', 2]])
  })

  it('reports unpushed and behind commits against the upstream', async () => {
    const origin = join(root, 'origin.git')
    const clone = join(root, 'clone')
    sh(root, 'init', '-q', '--bare', '-b', 'main', origin)
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-qu', 'origin', 'main')
    sh(root, 'clone', '-q', origin, clone)
    expect(await attention()).toEqual([])

    commitFile('local.txt', 'local')
    writeFileSync(join(clone, 'remote.txt'), 'remote')
    sh(clone, 'add', '-A')
    sh(clone, 'commit', '-qm', 'remote')
    sh(clone, 'push', '-q')
    await fetchRepo(repo)
    expect(await attention()).toMatchObject([
      { kind: 'unpushed', count: 1, against: 'origin/main', isMain: true },
      { kind: 'behind', count: 1, against: 'origin/main' },
    ])
  })

  it('reports an unpublished branch once, and not when its commits are already on a remote', async () => {
    const origin = join(root, 'origin.git')
    sh(root, 'init', '-q', '--bare', '-b', 'main', origin)
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-qu', 'origin', 'main')
    sh(repo, 'switch', '-qc', 'topic')
    expect(await attention()).toEqual([])
    commitFile('t.txt', 'topic 1')
    commitFile('u.txt', 'topic 2')
    expect(summary(await attention())).toEqual([['unpublished', 'topic', 2]])
  })

  it('finds a dirty worktree and branches that are not checked out anywhere', async () => {
    const origin = join(root, 'origin.git')
    sh(root, 'init', '-q', '--bare', '-b', 'main', origin)
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-qu', 'origin', 'main')
    sh(repo, 'push', '-qu', 'origin', 'feature')
    sh(repo, 'switch', '-q', 'feature')
    commitFile('f.txt', 'feature work')
    sh(repo, 'switch', '-q', 'main')

    const other = join(root, 'other')
    sh(repo, 'worktree', 'add', '-qb', 'wt-branch', other)
    writeFileSync(join(other, 'dirty.txt'), 'x')

    const items = await attention()
    expect(items.find((i) => i.kind === 'uncommitted')).toMatchObject({
      branch: 'wt-branch',
      worktree: other,
      isMain: false,
      count: 1,
    })
    expect(items.find((i) => i.branch === 'feature')).toMatchObject({
      kind: 'unpushed',
      worktree: null,
      count: 1,
    })
  })
})
