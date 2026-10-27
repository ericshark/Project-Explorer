import { useState } from 'react'
import type { ProjectDetail, WorktreeInfo } from '../../../shared/types.ts'
import { useProjectActions } from '../lib/actions.ts'
import { plural } from '../lib/branches.ts'
import { toast } from '../lib/toast.ts'
import { Button, Dialog } from './ui.tsx'

interface CommitDialogProps {
  open: boolean
  onClose: () => void
  project: ProjectDetail
  worktree: WorktreeInfo
}

export function CommitDialog({ open, onClose, project, worktree }: CommitDialogProps) {
  const { commit } = useProjectActions(project.id)
  const [message, setMessage] = useState('')
  const branch = worktree.git.branch ?? `detached @ ${worktree.git.head ?? '?'}`

  const submit = () =>
    commit.mutate(
      { worktree: worktree.path, message },
      {
        onSuccess: ({ head }) => {
          toast(`Committed ${head} on ${branch}`)
          setMessage('')
          onClose()
        },
      },
    )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Commit all changes"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={commit.isPending}
            disabled={!message.trim()}
            onClick={submit}
          >
            Commit
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (message.trim()) submit()
        }}
      >
        <p className="text-[13px] text-muted">
          Stages and commits {plural(worktree.git.dirty, 'changed file')}, including new files, on{' '}
          <span className="font-mono text-text">{branch}</span>.
        </p>
        <label className="text-[12.5px] font-medium" htmlFor="commit-message">
          Commit message
        </label>
        <textarea
          id="commit-message"
          autoFocus
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Enter commits, like most git UIs; plain Enter adds a line.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && message.trim()) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="Describe the change"
          className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-border-strong focus:ring-2 focus:ring-(--ring)"
        />
        <p className="text-[11.5px] text-faint">Ctrl+Enter to commit</p>
      </form>
    </Dialog>
  )
}
