import { describe, expect, it } from 'vitest'
import type { DiffHunk } from '../../../shared/types.ts'
import { toSideBySide } from './diff.ts'

const ctx = (oldNo: number, newNo: number, text: string) => ({
  kind: 'context' as const,
  text,
  oldNo,
  newNo,
})
const del = (oldNo: number, text: string) => ({ kind: 'del' as const, text, oldNo, newNo: null })
const add = (newNo: number, text: string) => ({ kind: 'add' as const, text, oldNo: null, newNo })

describe('toSideBySide', () => {
  it('shows unchanged lines on both sides and pairs a removal with its replacement', () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      newStart: 1,
      lines: [ctx(1, 1, 'a'), del(2, 'b'), add(2, 'B'), ctx(3, 3, 'c')],
    }
    expect(toSideBySide([hunk])).toEqual([
      {
        type: 'line',
        left: { no: 1, text: 'a', kind: 'context' },
        right: { no: 1, text: 'a', kind: 'context' },
      },
      {
        type: 'line',
        left: { no: 2, text: 'b', kind: 'del' },
        right: { no: 2, text: 'B', kind: 'add' },
      },
      {
        type: 'line',
        left: { no: 3, text: 'c', kind: 'context' },
        right: { no: 3, text: 'c', kind: 'context' },
      },
    ])
  })

  it('leaves blanks opposite the longer run', () => {
    const rows = toSideBySide([
      {
        oldStart: 1,
        newStart: 1,
        lines: [del(1, 'x'), del(2, 'y'), del(3, 'z'), add(1, 'X')],
      },
    ])
    expect(
      rows.map((r) => r.type === 'line' && [r.left?.text ?? null, r.right?.text ?? null]),
    ).toEqual([
      ['x', 'X'],
      ['y', null],
      ['z', null],
    ])
  })

  it('has an empty old side for a new file and an empty new side for a deleted one', () => {
    const added = toSideBySide([{ oldStart: 0, newStart: 1, lines: [add(1, 'a'), add(2, 'b')] }])
    expect(added.every((r) => r.type === 'line' && r.left === null && r.right !== null)).toBe(true)
    const removed = toSideBySide([{ oldStart: 1, newStart: 0, lines: [del(1, 'a')] }])
    expect(removed.every((r) => r.type === 'line' && r.right === null && r.left !== null)).toBe(
      true,
    )
  })

  it('separates hunks with a gap row', () => {
    const rows = toSideBySide([
      { oldStart: 1, newStart: 1, lines: [add(1, 'a')] },
      { oldStart: 40, newStart: 41, lines: [add(41, 'b')] },
    ])
    expect(rows.map((r) => r.type)).toEqual(['line', 'gap', 'line'])
  })
})
