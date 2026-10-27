import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { BranchList, ProjectDetail, WorktreeInfo } from '../../../shared/types.ts'
import { useProjectActions } from './actions.ts'
import { api, PROJECT_POLL_MS, type CheckoutTarget } from './api.ts'

/** What the git panels and dialogs need to switch the selected checkout, or send you elsewhere. */
export interface GitContext {
  project: ProjectDetail
  worktree: WorktreeInfo
  branches: BranchList
  home?: string
  switching: boolean
  onCheckout: (target: CheckoutTarget) => void
  onGoTo: (worktreePath: string) => void
  onCommitNow: () => void
}

export type GitDialogName = 'commit' | 'changes' | 'commits' | 'graph'

/**
 * Branch data and dialog state for the selected checkout. The page owns it because Services,
 * Git and Branches all open the same dialogs.
 */
export function useGitContext(
  project: ProjectDetail,
  worktree: WorktreeInfo,
  home: string | undefined,
  onSelectWorktree: (path: string) => void,
) {
  const { checkout } = useProjectActions(project.id)
  const [dialog, setDialog] = useState<GitDialogName | null>(null)
  const { data: branches } = useQuery({
    queryKey: ['git', project.id, 'branches', worktree.path],
    queryFn: () => api.branches(project.id, worktree.path),
    refetchInterval: PROJECT_POLL_MS,
  })

  const context: GitContext | null = branches
    ? {
        project,
        worktree,
        branches,
        home,
        switching: checkout.isPending,
        onCheckout: (target) => checkout.mutate({ worktree: worktree.path, target }),
        onGoTo: (path) => {
          setDialog(null)
          onSelectWorktree(path)
        },
        onCommitNow: () => setDialog('commit'),
      }
    : null

  return {
    context,
    dialog,
    openDialog: (name: GitDialogName) => setDialog(name),
    closeDialog: () => setDialog(null),
  }
}
