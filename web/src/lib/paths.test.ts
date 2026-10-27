import { describe, expect, it } from 'vitest'
import { resolveRelative } from './paths.ts'

describe('resolveRelative', () => {
  it.each([
    ['README.md', 'docs/design.md', 'docs/design.md'],
    ['README.md', './docs/design.md', 'docs/design.md'],
    ['docs/design.md', '../README.md', 'README.md'],
    ['docs/a/b.md', '../c.md', 'docs/c.md'],
    ['docs/design.md', '/backend/README.md', 'backend/README.md'],
    ['README.md', '../outside.md', null],
  ])('from %s, %s → %s', (from, target, expected) => {
    expect(resolveRelative(from, target)).toBe(expected)
  })
})
