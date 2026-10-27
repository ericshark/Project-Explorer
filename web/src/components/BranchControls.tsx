import { AlertTriangle, ArrowDown, ArrowUp, Undo2 } from 'lucide-react'
import type { BranchCompare, BranchInfo } from '../../../shared/types.ts'
import { branchState, localNameOf, plural } from '../lib/branches.ts'
import { cn, tildify } from '../lib/format.ts'
import type { GitContext } from '../lib/git-context.ts'
import { Button } from './ui.tsx'

/** "2 commits ahead, 4 commits behind main", or "Up to date with origin/main". */
export function CompareChips({
  compare,
  fallback,
  className,
}: {
  compare: BranchCompare | null
  /** Shown when there is nothing to compare with; nothing renders without it. */
  fallback?: string
  className?: string
}) {
  if (!compare) {
    return fallback ? (
      <span className={cn('text-[12px] text-faint', className)}>{fallback}</span>
    ) : null
  }
  const { ahead, behind, against } = compare
  if (ahead === 0 && behind === 0) {
    return (
      <span className={cn('text-[12px] text-faint', className)}>Up to date with {against}</span>
    )
  }
  return (
    <span
      className={cn('flex flex-wrap items-center gap-x-2 text-[12px] text-muted', className)}
      title={`Compared with ${against}`}
    >
      {ahead > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowUp className="size-3" />
          {plural(ahead, 'commit')} ahead{behind > 0 ? ',' : ` of ${against}`}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowDown className="size-3" />
          {plural(behind, 'commit')} behind {against}
        </span>
      )}
    </span>
  )
}

/** Shown while HEAD is detached: switches back to the branch the commit was checked out from. */
export function BackToBranch({ context }: { context: GitContext }) {
  const { branches, worktree } = context
  const target = branches.previousBranch
  if (branches.current || !target) return null
  const dirty = worktree.git.dirty > 0
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<Undo2 className="size-3.5" />}
      busy={context.switching}
      disabled={dirty}
      title={dirty ? 'Commit your changes first' : `Check out ${target} again`}
      onClick={() => context.onCheckout({ branch: target })}
    >
      Back to {target}
    </Button>
  )
}

/** Switch, a "current" marker, or a pointer to the checkout that already has the branch. */
export function BranchAction({ branch, context }: { branch: BranchInfo; context: GitContext }) {
  const { branches, worktree, home } = context
  const state = branchState(branch, branches, worktree.path)
  // A remote branch is switched to through its local branch, so name that one.
  const via = branch.remote ? ` as ${localNameOf(branch)}` : ''
  if (state.kind === 'current') {
    if (via) return <span className="text-[12px] text-muted">Checked out{via}</span>
    return (
      <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11.5px] font-medium text-ok">
        Current
      </span>
    )
  }
  if (state.kind === 'elsewhere') {
    return (
      <span className="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 text-[12px] text-warn">
        <span
          className="flex min-w-0 items-center gap-1"
          title={`Checked out in ${tildify(state.path, home)}`}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">Checked out{via}</span>
        </span>
        <Button size="sm" onClick={() => context.onGoTo(state.path)}>
          Go to that checkout
        </Button>
      </span>
    )
  }
  return (
    <Button
      size="sm"
      disabled={worktree.git.dirty > 0 || context.switching}
      title={worktree.git.dirty > 0 ? 'Commit your changes first' : undefined}
      onClick={() => context.onCheckout({ branch: branch.name })}
    >
      Switch
    </Button>
  )
}
