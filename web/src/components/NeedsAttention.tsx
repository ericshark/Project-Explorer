import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AttentionItem, ProjectSummary } from '../../../shared/types.ts'
import { plural } from '../lib/branches.ts'
import { cn } from '../lib/format.ts'
import { Panel } from './ui.tsx'

const CHIP_TONE: Record<AttentionItem['kind'], string> = {
  uncommitted: 'bg-warn-soft text-warn',
  unpushed: 'bg-link/10 text-link',
  unpublished: 'bg-link/10 text-link',
  behind: 'bg-surface-2 text-muted',
}

function describe(item: AttentionItem): string {
  const what = {
    uncommitted: `${plural(item.count, 'file')} uncommitted`,
    unpushed: `${plural(item.count, 'commit')} to push`,
    unpublished: `${plural(item.count, 'commit')} not on any remote`,
    behind: `${plural(item.count, 'commit')} behind`,
  }[item.kind]
  return item.branch ? `${what} on ${item.branch}` : what
}

/** Opens the checkout the item is about; a branch nobody has checked out opens the project. */
function hrefFor(project: ProjectSummary, item: AttentionItem): string {
  const base = `/p/${project.id}`
  return item.worktree && !item.isMain ? `${base}?wt=${encodeURIComponent(item.worktree)}` : base
}

function Chip({ project, item }: { project: ProjectSummary; item: AttentionItem }) {
  const label = {
    uncommitted: `${item.count} uncommitted`,
    unpushed: `${item.count} to push`,
    unpublished: `${item.count} unpublished`,
    behind: `${item.count} behind`,
  }[item.kind]
  return (
    <Link
      to={hrefFor(project, item)}
      title={`${describe(item)}${item.against ? ` (${item.against})` : ''}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium hover:brightness-95',
        CHIP_TONE[item.kind],
      )}
    >
      <span className="shrink-0">{label}</span>
      {item.branch && (!item.isMain || item.worktree === null) && (
        <span className="truncate font-mono text-[11px] font-normal opacity-80">{item.branch}</span>
      )}
    </Link>
  )
}

/** Projects with uncommitted changes, unpushed commits or branches behind origin. */
export function NeedsAttention({ projects }: { projects: ProjectSummary[] }) {
  const flagged = projects
    .filter((project) => project.attention.length > 0)
    .sort((a, b) => b.attention.length - a.attention.length || a.name.localeCompare(b.name))

  return (
    <Panel>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Needs attention</h2>
        {flagged.length > 0 && (
          <span className="text-[12.5px] text-faint">{plural(flagged.length, 'project')}</span>
        )}
      </div>
      {flagged.length === 0 ? (
        <p className="flex items-center gap-1.5 px-4 py-3 text-[13px] text-ok">
          <CheckCircle2 className="size-3.5" />
          Everything is committed and in sync.
        </p>
      ) : (
        <ul className="divide-y divide-border text-[13.5px]">
          {flagged.map((project) => (
            <li
              key={project.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
            >
              <Link
                to={`/p/${project.id}`}
                className="min-w-0 basis-40 truncate font-medium hover:underline"
              >
                {project.name}
              </Link>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {project.attention.map((item, index) => (
                  <Chip key={index} project={project} item={item} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
