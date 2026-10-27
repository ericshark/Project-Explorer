import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FolderGit2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BranchInfo, CommitInfo } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { branchState, localNameOf, plural } from '../lib/branches.ts'
import { cn, tildify, timeAgo } from '../lib/format.ts'
import { assignBranches, branchColors, layoutGraph, type GraphEdge } from '../lib/graph.ts'
import { CheckoutConfirm } from './CommitsDialog.tsx'
import type { GitContext } from '../lib/git-context.ts'
import { Button, Dialog } from './ui.tsx'

const ROW = 36
const LANE = 22
const PAD = 16
const laneX = (lane: number) => PAD + lane * LANE
const rowY = (row: number) => row * ROW + ROW / 2
/** A branch's color slot as a CSS color; commits no branch reaches are neutral grey. */
const slotColor = (slot: number | undefined) =>
  slot === undefined ? 'var(--faint)' : `var(--branch-${slot + 1})`

/** Runs straight down `viaLane`, bending at the child's or parent's row when lanes differ. */
function edgePath({ fromRow, fromLane, viaLane, toRow, toLane }: GraphEdge): string {
  const x1 = laneX(fromLane)
  const y1 = rowY(fromRow)
  const xv = laneX(viaLane)
  const x2 = laneX(toLane)
  const y2 = rowY(toRow)
  const bend = ROW * 0.8
  let path = `M${x1},${y1}`
  if (toRow - fromRow === 1) return `${path} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`
  if (xv !== x1) path += ` C${x1},${y1 + bend} ${xv},${y1 + ROW - bend} ${xv},${y1 + ROW}`
  if (xv !== x2) {
    path += ` L${xv},${y2 - ROW} C${xv},${y2 - ROW + bend} ${x2},${y2 - bend} ${x2},${y2}`
  } else {
    path += ` L${x2},${y2}`
  }
  return path
}

type Pending = { kind: 'commit'; commit: CommitInfo } | { kind: 'branch'; branch: BranchInfo }

interface GraphDialogProps {
  open: boolean
  onClose: () => void
  context: GitContext
}

export function GraphDialog({ open, onClose, context }: GraphDialogProps) {
  const { project, worktree } = context
  const [pending, setPending] = useState<Pending | null>(null)
  const graph = useQuery({
    queryKey: ['git', project.id, 'graph', worktree.path],
    queryFn: () => api.graph(project.id, worktree.path),
    enabled: open,
  })
  const commits = useMemo(() => graph.data?.commits ?? [], [graph.data])
  const layout = useMemo(() => layoutGraph(commits), [commits])
  const tips = useMemo(() => {
    const byHash = new Map<string, BranchInfo[]>()
    for (const branch of graph.data?.branches ?? []) {
      byHash.set(branch.head, [...(byHash.get(branch.head) ?? []), branch])
    }
    return byHash
  }, [graph.data])

  const { current, defaultBranch } = context.branches
  const { rowColors, colorOfBranch } = useMemo(() => {
    const branches = graph.data?.branches ?? []
    const tipList = branches.map((b) => ({ key: localNameOf(b), head: b.head, remote: b.remote }))
    const owners = assignBranches(commits, tipList, { current, defaultBranch })
    const slots = branchColors(
      tipList.map((tip) => tip.key),
      defaultBranch,
    )
    return {
      rowColors: owners.map((owner) => slotColor(owner ? slots.get(owner) : undefined)),
      colorOfBranch: (branch: BranchInfo) => slotColor(slots.get(localNameOf(branch))),
    }
  }, [graph.data, commits, current, defaultBranch])

  const close = () => {
    setPending(null)
    onClose()
  }

  const graphWidth = PAD * 2 + (layout.laneCount - 1) * LANE

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title={`Graph · ${project.name}`}
      toolbar={<Legend />}
      footer={
        pending &&
        (pending.kind === 'commit' ? (
          <CheckoutConfirm
            commit={pending.commit}
            context={context}
            onCancel={() => setPending(null)}
            onDone={() => setPending(null)}
          />
        ) : (
          <BranchConfirm
            branch={pending.branch}
            context={context}
            onCancel={() => setPending(null)}
          />
        ))
      }
    >
      {graph.isLoading ? (
        <p className="px-4 py-4 text-[13px] text-muted">Loading graph…</p>
      ) : commits.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">No commits.</p>
      ) : (
        <div className="relative py-1" style={{ minHeight: commits.length * ROW }}>
          <svg
            aria-hidden
            width={graphWidth}
            height={commits.length * ROW}
            className="absolute top-1 left-0"
          >
            {layout.edges.map((edge, index) => (
              <path
                key={index}
                d={edgePath(edge)}
                fill="none"
                stroke={
                  // A merge's second parent line takes the merged branch's color.
                  edge.parentIndex > 0 && edge.toRow < commits.length
                    ? rowColors[edge.toRow]
                    : rowColors[edge.fromRow]
                }
                strokeWidth={2.5}
              />
            ))}
            {commits.map((commit, row) => {
              const isHead = commit.hash === graph.data?.head
              return (
                <circle
                  key={commit.hash}
                  cx={laneX(layout.lanes[row])}
                  cy={rowY(row)}
                  r={isHead ? 7 : 5}
                  fill={isHead ? 'var(--surface)' : rowColors[row]}
                  stroke={rowColors[row]}
                  strokeWidth={isHead ? 3 : 0}
                />
              )
            })}
          </svg>
          <ul>
            {commits.map((commit) => (
              <li
                key={commit.hash}
                style={{ height: ROW, paddingLeft: graphWidth }}
                className={cn(
                  'flex items-center gap-2 pr-4 text-[13.5px] hover:bg-surface-2',
                  pending?.kind === 'commit' &&
                    pending.commit.hash === commit.hash &&
                    'bg-surface-2',
                )}
              >
                {(tips.get(commit.hash) ?? []).map((branch) => (
                  <BranchChip
                    key={branch.name}
                    branch={branch}
                    color={colorOfBranch(branch)}
                    context={context}
                    onClick={() => setPending({ kind: 'branch', branch })}
                  />
                ))}
                {commit.hash === graph.data?.head && !context.branches.current && (
                  <span className="shrink-0 rounded-md bg-text px-1.5 py-px font-mono text-[11px] text-bg">
                    HEAD
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPending({ kind: 'commit', commit })}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                  title={`Check out ${commit.short}`}
                >
                  <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                  <span
                    className="hidden w-36 shrink-0 truncate text-[12.5px] text-muted md:inline"
                    title={commit.author}
                  >
                    {commit.author}
                  </span>
                  <span className="w-16 shrink-0 font-mono text-[12px] text-faint">
                    {commit.short}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-[12px] text-faint sm:inline">
                    {timeAgo(commit.committedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded bg-branch-1" />
        <span className="h-0.5 w-4 rounded bg-branch-2" /> line and badge color = branch
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-ok" /> checked out, clean
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-bad" /> checked out, uncommitted changes
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border border-border-strong" /> not checked out
      </span>
      <span className="flex items-center gap-1.5">
        <FolderGit2 className="size-3" /> in another worktree
      </span>
      <span className="text-faint">Click a branch to switch, or a commit to check it out.</span>
    </div>
  )
}

function BranchChip({
  branch,
  color,
  context,
  onClick,
}: {
  branch: BranchInfo
  /** Identity color of the branch; unrelated to the status dot. */
  color: string
  context: GitContext
  onClick: () => void
}) {
  const checkedOut = !branch.remote && branch.checkedOutIn !== null
  const dirty = checkedOut && (branch.dirty ?? 0) > 0
  const here = branch.checkedOutIn === context.worktree.path
  const elsewhere = checkedOut && !here
  const where = branch.checkedOutIn
    ? here
      ? 'this checkout'
      : tildify(branch.checkedOutIn, context.home)
    : null
  const status = dirty
    ? `${plural(branch.dirty ?? 0, 'uncommitted file')}`
    : checkedOut
      ? 'clean'
      : null
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        where
          ? `Checked out in ${where}${status ? ` · ${status}` : ''}`
          : branch.remote
            ? 'Remote branch'
            : 'Not checked out'
      }
      style={{
        borderColor: color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
      className={cn(
        'inline-flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-px font-mono text-[12px] text-text transition hover:brightness-95',
        branch.remote && 'border-dashed',
        here && 'font-semibold',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full',
          dirty ? 'bg-bad' : checkedOut ? 'bg-ok' : 'border border-border-strong',
        )}
      />
      {elsewhere && (
        <FolderGit2 aria-label="Checked out in another worktree" className="size-3 shrink-0" />
      )}
      <span className="truncate">{branch.name}</span>
      {dirty && <span className="shrink-0 text-bad">· {branch.dirty}</span>}
    </button>
  )
}

function BranchConfirm({
  branch,
  context,
  onCancel,
}: {
  branch: BranchInfo
  context: GitContext
  onCancel: () => void
}) {
  const state = branchState(branch, context.branches, context.worktree.path)
  const dirty = context.worktree.git.dirty
  let message
  let action
  if (state.kind === 'current') {
    message = (
      <>
        <span className="font-mono">{branch.name}</span> is already checked out here.
      </>
    )
  } else if (state.kind === 'elsewhere') {
    message = (
      <span className="flex items-center gap-1.5 text-warn">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span>
          <span className="font-mono">{branch.name}</span> is checked out in{' '}
          {tildify(state.path, context.home)}
          {state.dirty ? ` (${plural(state.dirty, 'uncommitted file')})` : ''}.
        </span>
      </span>
    )
    action = (
      <Button size="sm" variant="primary" onClick={() => context.onGoTo(state.path)}>
        Go to that checkout
      </Button>
    )
  } else if (dirty > 0) {
    message = (
      <span className="flex items-center gap-1.5 text-bad">
        <AlertTriangle className="size-3.5 shrink-0" />
        Commit your changes before switching to {branch.name}.
      </span>
    )
    action = (
      <Button size="sm" variant="primary" onClick={context.onCommitNow}>
        Commit now
      </Button>
    )
  } else {
    message = (
      <>
        Switch this checkout to <span className="font-mono">{branch.name}</span>?
        {branch.remote && (
          <span className="text-faint"> Creates or uses the matching local branch.</span>
        )}
      </>
    )
    action = (
      <Button
        size="sm"
        variant="primary"
        busy={context.switching}
        onClick={() => {
          context.onCheckout({ branch: branch.name })
          onCancel()
        }}
      >
        Switch
      </Button>
    )
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <p className="mr-auto min-w-0 flex-1 basis-64 text-[12.5px]">{message}</p>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {action ? 'Cancel' : 'OK'}
      </Button>
      {action}
    </div>
  )
}
