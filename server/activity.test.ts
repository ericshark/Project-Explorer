import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityIndex, githubRepoOf, localDay } from './activity.ts'
import type { Repo } from './discovery.ts'

const ME = 'me@example.com'

let root: string
let repo: string

function sh(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim()
}

/** Commits as `email` at `when` (ISO date), on whatever branch `dir` has checked out. */
function commitAs(dir: string, email: string, when: string, message: string) {
  writeFileSync(join(dir, `${message.replace(/\W/g, '-')}.txt`), message)
  sh(dir, ['add', '-A'])
  sh(dir, ['commit', '-qm', message], {
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: when,
  })
}

function repoAt(path: string, relPath: string): Repo {
  return { id: relPath, root, relPath, path }
}

beforeAll(() => {
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_COMMITTER_NAME: 'Test',
  })
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-activity-'))
  repo = join(root, 'repo')
  sh(root, ['init', '-qb', 'main', repo])
  sh(repo, ['config', 'user.email', ME])
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('ActivityIndex', () => {
  it('counts only your commits, by local day', async () => {
    commitAs(repo, ME, '2026-03-02T10:00:00', 'mine 1')
    commitAs(repo, 'ME@Example.com', '2026-03-02T18:00:00', 'mine 2')
    commitAs(repo, 'someone@else.com', '2026-03-02T12:00:00', 'theirs')
    commitAs(repo, ME, '2026-03-05T09:00:00', 'mine 3')

    const index = new ActivityIndex({ lookup: async () => 'unknown' })
    const summary = await index.summary([repoAt(repo, 'repo')])
    expect(summary.days['2026-03-02']).toEqual({ local: 2, pushed: 0, public: 0, private: 0 })
    expect(summary.days['2026-03-05'].local).toBe(1)
    expect(summary.years).toEqual([2026])
    expect(summary.authorEmails).toEqual([ME])
    expect(summary.byProject).toEqual({ repo: { '2026-03-02': 2, '2026-03-05': 1 } })
  })

  it('marks pushed commits, includes ones only on origin, and splits by visibility', async () => {
    commitAs(repo, ME, '2026-04-01T10:00:00', 'pushed')
    const origin = join(root, 'origin.git')
    sh(root, ['init', '-q', '--bare', '-b', 'main', origin])
    sh(repo, ['remote', 'add', 'origin', origin])
    sh(repo, ['push', '-qu', 'origin', 'main'])
    commitAs(repo, ME, '2026-04-01T11:00:00', 'not pushed')

    // A commit pushed from another clone and only fetched here.
    const other = join(root, 'other')
    sh(root, ['clone', '-q', origin, other])
    commitAs(other, ME, '2026-04-02T10:00:00', 'from elsewhere')
    sh(other, ['push', '-q'])
    sh(repo, ['fetch', '-q'])
    // Pretend origin is on GitHub so visibility applies.
    sh(repo, ['config', 'remote.origin.pushurl', origin])
    sh(repo, ['config', 'remote.origin.url', 'git@github.com:me/repo.git'])

    const lookup = vi.fn(async () => 'public' as const)
    const index = new ActivityIndex({ lookup })
    const summary = await index.summary([repoAt(repo, 'repo')])
    expect(summary.days['2026-04-01']).toEqual({ local: 2, pushed: 1, public: 1, private: 0 })
    expect(summary.days['2026-04-02']).toEqual({ local: 0, pushed: 1, public: 1, private: 0 })
    expect(summary.totals).toEqual({ projects: 1, withRemote: 1, public: 1, private: 0 })
    expect(lookup).toHaveBeenCalledWith('me/repo')

    const day = await index.day([repoAt(repo, 'repo')], '2026-04-01', 'pushed')
    expect(day.map((c) => [c.subject, c.visibility])).toEqual([['pushed', 'public']])
  })

  it('counts a commit once when two clones have it', async () => {
    commitAs(repo, ME, '2026-05-01T10:00:00', 'shared')
    const clone = join(root, 'clone')
    sh(root, ['clone', '-q', repo, clone])
    sh(clone, ['config', 'user.email', ME])

    const index = new ActivityIndex({ lookup: async () => 'unknown' })
    const summary = await index.summary([repoAt(repo, 'repo'), repoAt(clone, 'clone')])
    expect(summary.days['2026-05-01'].local).toBe(1)
    const day = await index.day(
      [repoAt(repo, 'repo'), repoAt(clone, 'clone')],
      '2026-05-01',
      'local',
    )
    expect(day.map((c) => c.projectId)).toEqual(['repo'])
  })

  it('picks up new commits once a ref moves', async () => {
    commitAs(repo, ME, '2026-06-01T10:00:00', 'one')
    const index = new ActivityIndex({ lookup: async () => 'unknown' })
    const repos = [repoAt(repo, 'repo')]
    expect((await index.summary(repos)).days['2026-06-01'].local).toBe(1)

    commitAs(repo, ME, '2026-06-01T12:00:00', 'two')
    expect((await index.summary(repos)).days['2026-06-01'].local).toBe(2)
  })

  it('handles a repo with no commits', async () => {
    const index = new ActivityIndex({ lookup: async () => 'unknown' })
    const summary = await index.summary([repoAt(repo, 'repo')])
    expect(summary.days).toEqual({})
    expect(summary.years).toEqual([])
  })
})

describe('githubRepoOf', () => {
  it.each([
    ['git@github.com:me/repo.git', 'me/repo'],
    ['https://github.com/me/repo', 'me/repo'],
    ['https://token@github.com/me/repo.git', 'me/repo'],
    ['git@gitlab.com:me/repo.git', null],
  ])('%s → %s', (remote, expected) => {
    expect(githubRepoOf(remote)).toBe(expected)
  })
})

describe('localDay', () => {
  it('uses the local date, not UTC', () => {
    expect(localDay(new Date(2026, 0, 31, 23, 59).getTime())).toBe('2026-01-31')
  })
})
