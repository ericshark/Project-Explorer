import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitCommitHorizontal,
  GitFork,
  History,
  RefreshCw,
} from 'lucide-react'
import type { WorktreeInfo } from '../../../shared/types.ts'
import { useProjectActions } from '../lib/actions.ts'
import { plural } from '../lib/branches.ts'
import { timeAgo } from '../lib/format.ts'
import type { GitContext, GitDialogName } from '../lib/git-context.ts'
import { CompareChips } from './BranchControls.tsx'
import { Button, Panel } from './ui.tsx'

interface GitPanelProps {
  projectId: string
  worktree: WorktreeInfo
  context: GitContext | null
  onOpen: (dialog: GitDialogName) => void
}

/** The latest commit on the selected checkout and how its branch compares; no hashes here. */
export function GitPanel({ projectId, worktree, context, onOpen }: GitPanelProps) {
  const { git } = worktree
  const current = context?.branches.branches.find((b) => !b.remote && b.name === git.branch)
  const { fetch, pull, push } = useProjectActions(projectId)
  // Pull and Push only make sense once the repo has a remote, i.e. any remote branch exists.
  const hasRemote = Boolean(context?.branches.branches.some((b) => b.remote))
  const upstream = current?.upstream ?? null
  // `git status` counts these against the upstream, unlike `compare`, which may be against main.
  const behind = upstream ? (git.behind ?? 0) : 0
  const ahead = upstream ? (git.ahead ?? 0) : 0

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h2 className="text-[14px] font-semibold">Git</h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {hasRemote && (
            <>
              <Button
                size="sm"
                icon={<RefreshCw className="size-3.5" />}
                busy={fetch.isPending}
                disabled={!context}
                title="Fetch every remote's branches"
                onClick={() => fetch.mutate()}
              >
                Fetch
              </Button>
              <Button
                size="sm"
                icon={<ArrowDownToLine className="size-3.5" />}
                busy={pull.isPending}
                disabled={!git.branch || behind === 0}
                title={
                  !git.branch
                    ? 'Switch to a branch to pull'
                    : !upstream
                      ? `${git.branch} has no upstream branch`
                      : behind === 0
                        ? `Up to date with ${upstream}`
                        : `Fast-forward ${plural(behind, 'commit')} from ${upstream}`
                }
                onClick={() => pull.mutate({ worktree: worktree.path })}
              >
                {behind > 0 ? `Pull ${behind}` : 'Pull'}
              </Button>
              <Button
                size="sm"
                icon={<ArrowUpFromLine className="size-3.5" />}
                busy={push.isPending}
                disabled={!git.branch || (upstream !== null && ahead === 0)}
                title={
                  !git.branch
                    ? 'Switch to a branch to push'
                    : !upstream
                      ? `Push ${git.branch} to origin and track it`
                      : ahead === 0
                        ? `Nothing to push to ${upstream}`
                        : `Push ${plural(ahead, 'commit')} to ${upstream}`
                }
                onClick={() => push.mutate({ worktree: worktree.path })}
              >
                {!upstream && git.branch ? 'Publish branch' : ahead > 0 ? `Push ${ahead}` : 'Push'}
              </Button>
            </>
          )}
          <Button
            size="sm"
            icon={<History className="size-3.5" />}
            disabled={!context || !git.head}
            onClick={() => onOpen('commits')}
          >
            View all commits
          </Button>
          <Button
            size="sm"
            icon={<GitFork className="size-3.5" />}
            disabled={!context || !git.head}
            onClick={() => onOpen('graph')}
          >
            View graph
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
        {git.head ? (
          <div className="flex min-w-0 flex-1 basis-64 items-center gap-2">
            <GitCommitHorizontal className="size-4 shrink-0 text-muted" />
            <div className="min-w-0">
              <p className="truncate text-[13.5px]">{git.subject}</p>
              <p className="text-[12px] text-faint">
                Latest commit {timeAgo(git.committedAt)}
                {!git.branch && ' · detached HEAD'}
              </p>
            </div>
          </div>
        ) : (
          <p className="flex-1 text-[13px] text-faint">No commits yet</p>
        )}
        <CompareChips compare={current?.compare ?? null} />
      </div>
    </Panel>
  )
}
