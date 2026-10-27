import type { GitContext, GitDialogName } from '../lib/git-context.ts'
import { ChangesDialog } from './ChangesDialog.tsx'
import { CommitDialog } from './CommitDialog.tsx'
import { CommitsDialog } from './CommitsDialog.tsx'
import { GraphDialog } from './GraphDialog.tsx'

export function GitDialogs({
  context,
  dialog,
  onClose,
}: {
  context: GitContext
  dialog: GitDialogName | null
  onClose: () => void
}) {
  return (
    <>
      <CommitDialog
        open={dialog === 'commit'}
        onClose={onClose}
        project={context.project}
        worktree={context.worktree}
      />
      <ChangesDialog
        open={dialog === 'changes'}
        onClose={onClose}
        project={context.project}
        worktree={context.worktree}
      />
      <CommitsDialog open={dialog === 'commits'} onClose={onClose} context={context} />
      <GraphDialog open={dialog === 'graph'} onClose={onClose} context={context} />
    </>
  )
}
