import type { BranchInfo, BranchList } from '../../../shared/types.ts'

export type BranchState =
  | { kind: 'current' }
  | { kind: 'elsewhere'; path: string; dirty: number | null }
  | { kind: 'available' }

/** Local branch a remote branch is switched through: `origin/feat/x` → `feat/x`. */
export function localNameOf(branch: BranchInfo): string {
  return branch.remote ? branch.name.slice(branch.name.indexOf('/') + 1) : branch.name
}

/**
 * What switching `worktree` to `branch` would do. A remote branch counts as its local
 * counterpart, since that's the branch the server checks out.
 */
export function branchState(branch: BranchInfo, list: BranchList, worktree: string): BranchState {
  const name = localNameOf(branch)
  const local = list.branches.find((b) => !b.remote && b.name === name)
  if (!local?.checkedOutIn) return { kind: 'available' }
  if (local.checkedOutIn === worktree) return { kind: 'current' }
  return { kind: 'elsewhere', path: local.checkedOutIn, dirty: local.dirty }
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
