import { useInfiniteQuery } from '@tanstack/react-query'
import { AlertTriangle, GitBranch } from 'lucide-react'
import { useState } from 'react'
import type { CommitInfo } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { cn, commitTime, fullDate } from '../lib/format.ts'
import type { GitContext } from '../lib/git-context.ts'
import { BackToBranch, BranchAction } from './BranchControls.tsx'
import { Button, Dialog } from './ui.tsx'

const PAGE_SIZE = 100

interface CommitsDialogProps {
  open: boolean
  onClose: () => void
  context: GitContext
}

export function CommitsDialog({ open, onClose, context }: CommitsDialogProps) {
  const { project, worktree, branches } = context
  const [picked, setPicked] = useState<string | null>(null)
  const [pending, setPending] = useState<CommitInfo | null>(null)
  const viewed = picked ?? branches.current ?? 'HEAD'
  const viewedBranch = branches.branches.find((b) => b.name === viewed)

  const commits = useInfiniteQuery({
    queryKey: ['git', project.id, 'commits', worktree.path, viewed],
    queryFn: ({ pageParam }) => api.commits(project.id, worktree.path, viewed, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.reduce((n, page) => n + page.length, 0) : undefined,
    enabled: open,
  })
  const list = commits.data?.pages.flat() ?? []

  const close = () => {
    setPicked(null)
    setPending(null)
    onClose()
  }

  const tabs = [...(branches.current ? [] : ['HEAD']), ...branches.branches.map((b) => b.name)]

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Commits · ${project.name}`}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {tabs.length <= 1 ? (
            <span className="flex items-center gap-1.5 font-mono text-[12.5px] font-medium">
              <GitBranch className="size-3.5 text-muted" />
              {tabs[0] === 'HEAD' ? 'detached HEAD' : tabs[0]}
            </span>
          ) : (
            <div role="tablist" className="-mb-1 flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
              {tabs.map((name) => (
                <button
                  key={name}
                  role="tab"
                  type="button"
                  aria-selected={name === viewed}
                  onClick={() => {
                    setPicked(name)
                    setPending(null)
                  }}
                  className={cn(
                    'shrink-0 cursor-pointer rounded-md border px-2 py-1 font-mono text-[12px] transition',
                    name === viewed
                      ? 'border-text/70 bg-surface-2 text-text'
                      : 'border-border text-muted hover:border-border-strong hover:text-text',
                  )}
                >
                  {name === 'HEAD' ? 'detached HEAD' : name}
                  {name === branches.current && <span className="ml-1 text-ok">●</span>}
                </button>
              ))}
            </div>
          )}
          {viewedBranch && <BranchAction branch={viewedBranch} context={context} />}
          <BackToBranch context={context} />
        </div>
      }
      footer={
        pending && (
          <CheckoutConfirm
            commit={pending}
            context={context}
            onCancel={() => setPending(null)}
            onDone={() => setPending(null)}
          />
        )
      }
    >
      {commits.isLoading ? (
        <p className="px-4 py-4 text-[13px] text-muted">Loading commits…</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">No commits.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((commit) => {
            const isHead = commit.hash === branches.head
            return (
              <li
                key={commit.hash}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2',
                  pending?.hash === commit.hash && 'bg-surface-2',
                )}
              >
                <span className="w-16 shrink-0 font-mono text-[12px] text-faint">
                  {commit.short}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-[13px]">{commit.subject}</p>
                  <p className="text-[11.5px] text-faint" title={fullDate(commit.committedAt)}>
                    {commit.author} · {commitTime(commit.committedAt)}
                  </p>
                </div>
                {isHead ? (
                  <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11.5px] font-medium text-ok">
                    Checked out
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setPending(commit)}>
                    Check out
                  </Button>
                )}
              </li>
            )
          })}
          {commits.hasNextPage && (
            <li className="px-4 py-3 text-center">
              <Button
                size="sm"
                busy={commits.isFetchingNextPage}
                onClick={() => void commits.fetchNextPage()}
              >
                Load older commits
              </Button>
            </li>
          )}
        </ul>
      )}
    </Dialog>
  )
}

/** Confirms checking out a single commit, which leaves the checkout on a detached HEAD. */
export function CheckoutConfirm({
  commit,
  context,
  onCancel,
  onDone,
}: {
  commit: Pick<CommitInfo, 'hash' | 'short' | 'subject'>
  context: GitContext
  onCancel: () => void
  onDone: () => void
}) {
  const dirty = context.worktree.git.dirty
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <p className="mr-auto min-w-0 flex-1 basis-64 text-[12.5px]">
        {dirty > 0 ? (
          <span className="flex items-center gap-1.5 text-bad">
            <AlertTriangle className="size-3.5 shrink-0" />
            Commit your changes before checking out another commit.
          </span>
        ) : (
          <>
            Check out <span className="font-mono">{commit.short}</span>{' '}
            <span className="text-muted">“{commit.subject}”</span>?{' '}
            <span className="text-faint">
              This detaches HEAD; create a branch there before committing.
            </span>
          </>
        )}
      </p>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {dirty > 0 ? (
        <Button size="sm" variant="primary" onClick={context.onCommitNow}>
          Commit now
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          busy={context.switching}
          onClick={() => {
            context.onCheckout({ commit: commit.hash })
            onDone()
          }}
        >
          Check out
        </Button>
      )}
    </div>
  )
}
