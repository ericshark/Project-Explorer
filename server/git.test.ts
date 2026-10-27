import { describe, expect, it } from 'vitest'
import {
  parseBranches,
  parseLog,
  parsePreviousBranch,
  parseStatus,
  parseTrack,
  parseWorktreeList,
  toWebUrl,
} from './git.ts'

describe('parseWorktreeList', () => {
  it('marks the first entry as main and reads branches', () => {
    const porcelain = [
      'worktree /home/me/GitHub/site\nHEAD abc\nbranch refs/heads/main',
      'worktree /home/me/.codex/worktrees/d094/site\nHEAD def\nbranch refs/heads/codex/example',
      'worktree /home/me/GitHub/site/.claude/worktrees/x\nHEAD 123\ndetached',
      '',
    ].join('\n\n')
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/home/me/GitHub/site', isMain: true, branch: 'main' },
      { path: '/home/me/.codex/worktrees/d094/site', isMain: false, branch: 'codex/example' },
      { path: '/home/me/GitHub/site/.claude/worktrees/x', isMain: false, branch: null },
    ])
  })

  it('skips bare repositories', () => {
    expect(parseWorktreeList('worktree /srv/repo.git\nbare\n')).toEqual([])
  })
})

describe('parseStatus', () => {
  it('reads branch, ahead/behind and counts changed entries', () => {
    const status = [
      '# branch.oid 85811eb',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a a src/a.ts',
      '? src/new.ts',
      '',
    ].join('\n')
    expect(parseStatus(status)).toEqual({ branch: 'feature/x', ahead: 2, behind: 1, dirty: 2 })
  })

  it('reports a detached HEAD as a null branch', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head (detached)\n').branch).toBeNull()
  })
})

describe('toWebUrl', () => {
  it.each([
    ['git@github.com:example/sample-api.git', 'https://github.com/example/sample-api'],
    ['ssh://git@github.com/example/x.git', 'https://github.com/example/x'],
    ['https://github.com/example/sample-site.git', 'https://github.com/example/sample-site'],
    ['https://token@github.com/a/b.git', 'https://github.com/a/b'],
    ['/local/path/repo', null],
  ])('%s → %s', (remote, expected) => {
    expect(toWebUrl(remote)).toBe(expected)
  })
})

describe('parseBranches', () => {
  it('reads local and remote branches and skips remote HEAD pointers', () => {
    const out = [
      ['refs/heads/main', 'aaa', '100', 'origin/main', 'ahead 2', 'Init'],
      ['refs/remotes/origin/HEAD', 'aaa', '100', '', '', 'Init'],
      ['refs/remotes/origin/feat/x', 'bbb', '200', '', '', 'Add x'],
    ]
      .map((fields) => fields.join('\0'))
      .join('\n')
    expect(parseBranches(out)).toEqual([
      {
        name: 'main',
        remote: false,
        head: 'aaa',
        subject: 'Init',
        committedAt: 100_000,
        upstream: 'origin/main',
        checkedOutIn: null,
        dirty: null,
        compare: { against: 'origin/main', ahead: 2, behind: 0 },
      },
      {
        name: 'origin/feat/x',
        remote: true,
        head: 'bbb',
        subject: 'Add x',
        committedAt: 200_000,
        upstream: null,
        checkedOutIn: null,
        dirty: null,
        compare: null,
      },
    ])
  })
})

describe('parseLog', () => {
  it('splits parents into a list', () => {
    const out = [
      ['h2', 's2', 'h1 h0', 'Ann', '300', 'Merge x'],
      ['h0', 's0', '', 'Bob', '100', 'Root'],
    ]
      .map((fields) => fields.join('\0'))
      .join('\n')
    const [merge, rootCommit] = parseLog(out)
    expect(merge).toMatchObject({
      hash: 'h2',
      parents: ['h1', 'h0'],
      author: 'Ann',
      committedAt: 300_000,
    })
    expect(rootCommit.parents).toEqual([])
  })
})

describe('parseTrack', () => {
  it.each([
    ['', { against: 'origin/main', ahead: 0, behind: 0 }],
    ['ahead 3', { against: 'origin/main', ahead: 3, behind: 0 }],
    ['ahead 2, behind 5', { against: 'origin/main', ahead: 2, behind: 5 }],
    ['gone', null],
  ])('%j', (track, expected) => {
    expect(parseTrack(track, 'origin/main')).toEqual(expected)
  })

  it('needs an upstream', () => {
    expect(parseTrack('', '')).toBeNull()
  })
})

describe('parsePreviousBranch', () => {
  const locals = new Set(['main', 'feature'])

  it('skips commit-to-commit hops back to the branch that was left', () => {
    const reflog = [
      'checkout: moving from 9ea86c2 to ce937e2',
      'checkout: moving from main to 9ea86c2',
      'commit: Work',
      'checkout: moving from feature to main',
    ].join('\n')
    expect(parsePreviousBranch(reflog, locals)).toBe('main')
  })

  it('ignores branches that no longer exist', () => {
    const reflog =
      'checkout: moving from gone-branch to abc\ncheckout: moving from feature to gone-branch'
    expect(parsePreviousBranch(reflog, locals)).toBe('feature')
    expect(parsePreviousBranch('commit: x', locals)).toBeNull()
  })
})
