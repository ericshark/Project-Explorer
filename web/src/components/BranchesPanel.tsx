import { AlertTriangle, GitBranch } from 'lucide-react'
import type { BranchInfo } from '../../../shared/types.ts'
import { cn, timeAgo } from '../lib/format.ts'
import type { GitContext } from '../lib/git-context.ts'
import { BranchAction, CompareChips } from './BranchControls.tsx'
import { useSettings } from '../lib/settings.ts'
import { CollapsiblePanel, Panel } from './ui.tsx'

export function BranchesPanel({ context }: { context: GitContext | null }) {
  const { expandBranches } = useSettings()
  if (!context) {
    return (
      <Panel>
        <p className="px-4 py-3 text-[13px] text-muted">Loading branches…</p>
      </Panel>
    )
  }

  const { branches, worktree } = context
  const local = branches.branches.filter((b) => !b.remote)
  const remote = branches.branches.filter((b) => b.remote)
  const dirty = worktree.git.dirty > 0

  return (
    <CollapsiblePanel
      // Keyed so changing the default in Settings applies to a page that is already open.
      key={String(expandBranches)}
      title="Branches"
      badge={<span className="text-[12.5px] text-faint">{local.length}</span>}
      defaultExpanded={expandBranches}
    >
      {dirty && local.length + remote.length > 1 && (
        <p className="flex flex-wrap items-center gap-2 border-t border-border bg-bad-soft/60 px-4 py-2 text-[12.5px] text-bad">
          <AlertTriangle className="size-3.5 shrink-0" />
          Commit your changes before switching branches.
          <button
            type="button"
            onClick={context.onCommitNow}
            className="cursor-pointer font-medium underline underline-offset-2"
          >
            Commit now
          </button>
        </p>
      )}

      <ul className="divide-y divide-border border-t border-border">
        {local.map((branch) => (
          <BranchRow key={branch.name} branch={branch} context={context} />
        ))}
      </ul>

      {remote.length > 0 && (
        <>
          <h3 className="border-t border-border bg-surface-2/60 px-4 py-1.5 text-[11.5px] font-medium tracking-wide text-faint uppercase">
            Remote branches · {remote.length}
          </h3>
          <ul className="divide-y divide-border border-t border-border">
            {remote.map((branch) => (
              <BranchRow key={branch.name} branch={branch} context={context} />
            ))}
          </ul>
        </>
      )}
    </CollapsiblePanel>
  )
}

function BranchRow({ branch, context }: { branch: BranchInfo; context: GitContext }) {
  const isCurrent = branch.checkedOutIn === context.worktree.path
  const isDefault = branch.name === context.branches.defaultBranch
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-1.5">
          <GitBranch className={cn('size-3.5 shrink-0', isCurrent ? 'text-ok' : 'text-faint')} />
          <span
            className={cn(
              'truncate font-mono text-[13px]',
              isCurrent ? 'font-semibold' : branch.remote && 'text-muted',
            )}
          >
            {branch.name}
          </span>
          {isDefault && (
            <span className="rounded border border-border px-1 text-[10.5px] text-faint">
              default
            </span>
          )}
        </div>
        <div className="mt-0.5 pl-5 text-[12px] text-muted">
          <p className="truncate">
            {branch.subject}
            <span className="text-faint"> · {timeAgo(branch.committedAt)}</span>
          </p>
          <CompareChips
            className="mt-0.5"
            compare={branch.compare}
            fallback={isDefault ? 'No remote branch to compare with' : undefined}
          />
        </div>
      </div>
      <BranchAction branch={branch} context={context} />
    </li>
  )
}
