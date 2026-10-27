import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { commitPaths, fileDiff, listChanges, parseUnifiedDiff } from './changes.ts'
import { getGitInfo } from './git.ts'

let root: string
let repo: string

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(name: string, content: string | Buffer) {
  writeFileSync(join(repo, name), content)
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
  root = mkdtempSync(join(tmpdir(), 'hub-changes-'))
  repo = join(root, 'repo')
  sh(root, 'init', '-qb', 'main', repo)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function seed() {
  write('keep.txt', 'one\ntwo\nthree\n')
  write('gone.txt', 'bye\n')
  write('old-name.txt', 'a long enough body\nto be seen as a rename\nby git\n')
  sh(repo, 'add', '-A')
  sh(repo, 'commit', '-qm', 'seed')
}

describe('listChanges', () => {
  it('reports modified, deleted, renamed, untracked and binary files', async () => {
    seed()
    write('keep.txt', 'one\nTWO\nthree\nfour\n')
    unlinkSync(join(repo, 'gone.txt'))
    sh(repo, 'mv', 'old-name.txt', 'new name.txt')
    write('fresh.txt', 'a\nb\n')
    write('image.bin', Buffer.from([0, 1, 2, 3]))

    const byPath = Object.fromEntries((await listChanges(repo)).map((c) => [c.path, c]))
    expect(byPath['keep.txt']).toMatchObject({ status: 'modified', additions: 2, deletions: 1 })
    expect(byPath['gone.txt']).toMatchObject({ status: 'deleted', deletions: 1 })
    expect(byPath['new name.txt']).toMatchObject({ status: 'renamed', origPath: 'old-name.txt' })
    expect(byPath['fresh.txt']).toMatchObject({ status: 'untracked', additions: 2 })
    expect(byPath['image.bin']).toMatchObject({ status: 'untracked', binary: true })
  })

  it('lists untracked files inside new directories one by one', async () => {
    seed()
    mkdirSync(join(repo, 'dir/sub'), { recursive: true })
    write('dir/a.txt', 'a\n')
    write('dir/sub/b.txt', 'b\n')
    expect((await listChanges(repo)).map((c) => c.path)).toEqual(['dir/a.txt', 'dir/sub/b.txt'])
  })

  it('works in a repo with no commits yet', async () => {
    write('first.txt', 'hello\n')
    write('staged.txt', 'staged\n')
    sh(repo, 'add', 'staged.txt')
    const changes = await listChanges(repo)
    expect(changes.map((c) => [c.path, c.status, c.additions])).toEqual([
      ['first.txt', 'untracked', 1],
      ['staged.txt', 'added', 1],
    ])
  })

  it('is empty for a clean checkout', async () => {
    seed()
    expect(await listChanges(repo)).toEqual([])
  })
})

describe('fileDiff', () => {
  it('diffs a modified file with line numbers', async () => {
    seed()
    write('keep.txt', 'one\nTWO\nthree\n')
    const diff = await fileDiff(repo, 'keep.txt', false)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].lines).toEqual([
      { kind: 'context', text: 'one', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'two', oldNo: 2, newNo: null },
      { kind: 'add', text: 'TWO', oldNo: null, newNo: 2 },
      { kind: 'context', text: 'three', oldNo: 3, newNo: 3 },
    ])
  })

  it('shows a deleted file as all removals and an untracked one as all additions', async () => {
    seed()
    unlinkSync(join(repo, 'gone.txt'))
    write('fresh.txt', 'x\ny\n')
    const deleted = await fileDiff(repo, 'gone.txt', false)
    expect(deleted.hunks[0].lines.map((l) => l.kind)).toEqual(['del'])
    const fresh = await fileDiff(repo, 'fresh.txt', false)
    expect(fresh.hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([
      ['add', 'x'],
      ['add', 'y'],
    ])
  })

  it('diffs against the empty tree before the first commit', async () => {
    write('first.txt', 'hello\n')
    sh(repo, 'add', 'first.txt')
    expect((await fileDiff(repo, 'first.txt', false)).hunks[0].lines).toHaveLength(1)
  })

  it('flags binary files and can show a whole file', async () => {
    seed()
    write('image.bin', Buffer.from([0, 1, 2]))
    expect(await fileDiff(repo, 'image.bin', false)).toMatchObject({ binary: true, hunks: [] })

    write('keep.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\nELEVEN\n')
    const full = await fileDiff(repo, 'keep.txt', true)
    expect(full.hunks[0].lines.filter((l) => l.kind === 'context')).toHaveLength(3)
  })

  it('shows a rename with its edits', async () => {
    seed()
    renameSync(join(repo, 'old-name.txt'), join(repo, 'renamed.txt'))
    write('renamed.txt', 'a long enough body\nto be seen as a rename\nby git!\n')
    sh(repo, 'add', '-A')
    const diff = await fileDiff(repo, 'renamed.txt', false)
    expect(diff.hunks[0].lines.filter((l) => l.kind !== 'context')).toHaveLength(2)
  })

  it('rejects paths git did not report as changed', async () => {
    seed()
    await expect(fileDiff(repo, 'keep.txt', false)).rejects.toMatchObject({ status: 404 })
    await expect(fileDiff(repo, '../../etc/passwd', false)).rejects.toMatchObject({ status: 404 })
  })
})

describe('commitPaths', () => {
  it('commits only the selected files and leaves the rest dirty', async () => {
    seed()
    write('keep.txt', 'changed\n')
    unlinkSync(join(repo, 'gone.txt'))
    write('fresh.txt', 'new\n')
    write('other.txt', 'not selected\n')

    await commitPaths(repo, 'Partial', ['keep.txt', 'gone.txt', 'fresh.txt'])
    expect(sh(repo, 'show', '--name-status', '--format=', 'HEAD').split('\n').sort()).toEqual([
      'A\tfresh.txt',
      'D\tgone.txt',
      'M\tkeep.txt',
    ])
    expect((await listChanges(repo)).map((c) => c.path)).toEqual(['other.txt'])
    expect((await getGitInfo(repo)).dirty).toBe(1)
  })

  it('keeps other staged changes out of the commit', async () => {
    seed()
    write('keep.txt', 'changed\n')
    write('staged.txt', 'staged\n')
    sh(repo, 'add', 'staged.txt')
    await commitPaths(repo, 'Only keep', ['keep.txt'])
    expect(sh(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('keep.txt')
    expect(sh(repo, 'diff', '--cached', '--name-only')).toBe('staged.txt')
  })

  it('commits both sides of a rename', async () => {
    seed()
    sh(repo, 'mv', 'old-name.txt', 'moved.txt')
    await commitPaths(repo, 'Move', ['moved.txt'])
    expect(sh(repo, 'show', '--name-status', '--format=', '-M', 'HEAD')).toMatch(
      /^R\d+\told-name\.txt\tmoved\.txt$/,
    )
  })

  it('makes the first commit of a new repo', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    await commitPaths(repo, 'Initial', ['a.txt'])
    expect(sh(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('a.txt')
    expect((await listChanges(repo)).map((c) => c.path)).toEqual(['b.txt'])
  })

  it('rejects empty selections, blank messages and unknown paths', async () => {
    seed()
    write('keep.txt', 'changed\n')
    await expect(commitPaths(repo, 'msg', [])).rejects.toMatchObject({ status: 400 })
    await expect(commitPaths(repo, '  ', ['keep.txt'])).rejects.toMatchObject({ status: 400 })
    await expect(commitPaths(repo, 'msg', ['gone.txt'])).rejects.toMatchObject({ status: 404 })
    await expect(commitPaths(repo, 'msg', [':(top)*'])).rejects.toMatchObject({ status: 404 })
    expect(sh(repo, 'rev-list', '--count', 'HEAD')).toBe('1')
  })
})

describe('parseUnifiedDiff', () => {
  it('numbers lines per hunk and ignores the no-newline marker', () => {
    const hunks = parseUnifiedDiff(
      [
        'diff --git a/f b/f',
        '--- a/f',
        '+++ b/f',
        '@@ -5,2 +5,2 @@ fn',
        ' keep',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '@@ -20 +20 @@',
        '-x',
        '+y',
        '',
      ].join('\n'),
    )
    expect(hunks.map((h) => [h.oldStart, h.newStart, h.lines.length])).toEqual([
      [5, 5, 3],
      [20, 20, 2],
    ])
    expect(hunks[0].lines[2]).toEqual({ kind: 'add', text: 'new', oldNo: null, newNo: 6 })
  })

  it('keeps removed lines that look like diff headers', () => {
    const [hunk] = parseUnifiedDiff('@@ -1,2 +1,1 @@\n--- not a header\n+++ also content\n')
    expect(hunk.lines.map((l) => l.text)).toEqual(['-- not a header', '++ also content'])
  })
})
