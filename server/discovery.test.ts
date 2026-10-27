import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectStack, findRepos, listDocs, readmeSummary, stackCategory } from './discovery.ts'

let root: string

function touch(path: string, content = '') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-discovery-'))
  mkdirSync(join(root, 'site/.git'), { recursive: true })
  // A worktree checked out inside the repo: a `.git` file in a dot-dir.
  touch(
    join(root, 'site/.claude/worktrees/feature/.git'),
    'gitdir: ../../../.git/worktrees/feature',
  )
  mkdirSync(join(root, 'misc/api/.git'), { recursive: true })
  mkdirSync(join(root, 'misc/templates/starter/.git'), { recursive: true })
  mkdirSync(join(root, 'misc/templates/starter/packages/inner/.git'), { recursive: true })
  mkdirSync(join(root, 'tools/node_modules/dep/.git'), { recursive: true })
  mkdirSync(join(root, 'empty-folder'), { recursive: true })
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('findRepos', () => {
  it('finds nested repos without descending into them or into skipped dirs', () => {
    expect(findRepos(root).map((repo) => [repo.relPath, repo.id])).toEqual([
      ['misc/api', 'misc--api'],
      ['misc/templates/starter', 'misc--templates--starter'],
      ['site', 'site'],
    ])
  })

  it('honours the ignore list for repos and whole folders', () => {
    expect(findRepos(root, ['misc/api', 'misc/templates']).map((repo) => repo.relPath)).toEqual([
      'site',
    ])
  })
})

describe('listDocs', () => {
  it('orders README first, then other top-level docs, docs/, and sub-READMEs', () => {
    const dir = join(root, 'site')
    touch(join(dir, 'CLAUDE.md'))
    touch(join(dir, 'README.md'))
    touch(join(dir, 'docs/design.md'))
    touch(join(dir, 'docs/notes/deep.md'))
    touch(join(dir, 'backend/README.md'))
    touch(join(dir, 'node_modules/pkg/README.md'))
    expect(listDocs(dir)).toEqual([
      'README.md',
      'CLAUDE.md',
      'docs/design.md',
      'docs/notes/deep.md',
      'backend/README.md',
    ])
  })
})

describe('detectStack', () => {
  it('combines manifests from the root and one level down', () => {
    const dir = join(root, 'misc/api')
    touch(
      join(dir, 'frontend/package.json'),
      JSON.stringify({ dependencies: { next: '16', react: '19' } }),
    )
    touch(join(dir, 'backend/requirements.txt'), 'fastapi==0.115\nuvicorn\n')
    touch(join(dir, 'docker-compose.yml'), 'services: {}')
    expect(detectStack(dir)).toEqual(['Next.js', 'React', 'FastAPI', 'Python', 'Docker'])
  })
})

describe('readmeSummary', () => {
  it('skips headings, badges, code and diagrams to find the first prose paragraph', () => {
    const readme = [
      '# ⌁ Agent Tracer',
      '[![CI](https://x/badge.svg)](https://x)',
      '```\n┌──────┐ diagram\n```',
      '**A developer platform** for debugging [agents](https://example.com).',
      'Second paragraph.',
    ].join('\n\n')
    expect(readmeSummary(readme)).toBe('A developer platform for debugging agents.')
  })

  it('returns null when there is no prose', () => {
    expect(readmeSummary('# Title\n\n- a list item that is long enough to count')).toBeNull()
  })
})

describe('stackCategory', () => {
  it.each([
    [
      ['Vite', 'React', 'Tailwind', 'TypeScript', 'FastAPI', 'Python', 'Docker'],
      'Full-stack (Python + JS)',
    ],
    [['Next.js', 'React', 'TypeScript', 'FastAPI', 'Python'], 'Full-stack (Python + JS)'],
    [['Next.js', 'React', 'Tailwind', 'TypeScript'], 'Next.js'],
    [['Vite', 'React', 'TypeScript'], 'Vite + React'],
    [['Vite'], 'Vite'],
    [['FastAPI', 'Python', 'Docker'], 'Python'],
    [['TypeScript', 'Node'], 'Node'],
    [['Docker'], 'Other'],
    [[], 'Other'],
  ])('puts %j in %s', (stack, category) => {
    expect(stackCategory(stack)).toBe(category)
  })
})
