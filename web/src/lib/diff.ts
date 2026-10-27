import type { DiffHunk } from '../../../shared/types.ts'

export interface DiffSide {
  no: number
  text: string
  /** `context` for unchanged lines, `del` on the old side, `add` on the new side. */
  kind: 'context' | 'del' | 'add'
}

export type DiffRow =
  { type: 'gap'; hunk: number } | { type: 'line'; left: DiffSide | null; right: DiffSide | null }

/**
 * Lays hunks out as before/after rows: unchanged lines appear on both sides, and each run of
 * removals is paired line by line with the run of additions that follows it. Whichever run is
 * longer leaves blanks opposite its extra lines. A `gap` row precedes every hunk after the first.
 */
export function toSideBySide(hunks: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  hunks.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) rows.push({ type: 'gap', hunk: hunkIndex })
    let removed: DiffSide[] = []
    let added: DiffSide[] = []
    const flush = () => {
      const count = Math.max(removed.length, added.length)
      for (let i = 0; i < count; i++) {
        rows.push({ type: 'line', left: removed[i] ?? null, right: added[i] ?? null })
      }
      removed = []
      added = []
    }
    for (const line of hunk.lines) {
      if (line.kind === 'del') {
        removed.push({ no: line.oldNo!, text: line.text, kind: 'del' })
      } else if (line.kind === 'add') {
        added.push({ no: line.newNo!, text: line.text, kind: 'add' })
      } else {
        flush()
        rows.push({
          type: 'line',
          left: { no: line.oldNo!, text: line.text, kind: 'context' },
          right: { no: line.newNo!, text: line.text, kind: 'context' },
        })
      }
    }
    flush()
  })
  return rows
}
