import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, GitBranch, Play, RotateCw, Square } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ProjectSummary, RunInfo } from '../../../shared/types.ts'
import { useProjectActions } from '../lib/actions.ts'
import { mostActive, type ProjectRecency } from '../lib/activity.ts'
import { api, PROJECT_POLL_MS } from '../lib/api.ts'
import { plural } from '../lib/branches.ts'
import { cn, isActive, overallStatus, timeAgo } from '../lib/format.ts'
import { toastError } from '../lib/toast.ts'
import { ActivitySection } from './ActivitySection.tsx'
import { NeedsAttention } from './NeedsAttention.tsx'
import { Button, Chip, OpenButton, Panel, StatusDot, StatusPill } from './ui.tsx'

/** Two rows of the three-column grid. */
const MOST_ACTIVE_COUNT = 6

function branchOf(project: ProjectSummary, worktree: string): string | null {
  const ref = project.worktrees.find((wt) => wt.path === worktree)
  if (!ref || ref.isMain) return null
  return ref.branch ?? 'detached'
}

function RunningRow({ project, run }: { project: ProjectSummary; run: RunInfo }) {
  const { restart } = useProjectActions(project.id)
  const branch = branchOf(project, run.worktree)
  const search = branch ? `?wt=${encodeURIComponent(run.worktree)}` : ''
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <StatusDot status={run.status} />
      <Link to={`/p/${project.id}${search}`} className="min-w-0 font-medium hover:underline">
        {project.name}
      </Link>
      <span className="font-mono text-[12.5px] text-muted">{run.name}</span>
      {branch && (
        <span className="flex min-w-0 items-center gap-1 font-mono text-[12px] text-faint">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {run.port && <span className="font-mono text-[12.5px] text-muted">:{run.port}</span>}
        {run.url && (
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-[13px] font-medium text-link hover:underline"
          >
            Open <ArrowUpRight className="size-3.5" />
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Restart ${project.name} ${run.name}`}
          title="Restart"
          icon={<RotateCw className="size-3" />}
          busy={restart.isPending}
          disabled={run.status === 'stopping'}
          onClick={() => restart.mutate({ worktree: run.worktree, service: run.name })}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Stop ${project.name} ${run.name}`}
          title="Stop"
          icon={<Square className="size-3" />}
          disabled={run.status === 'stopping'}
          onClick={() => api.stopRun(run.id).catch(toastError)}
        />
      </span>
    </li>
  )
}

/** Bars for the last 30 days of commits, oldest first. */
function Sparkline({ series }: { series: number[] }) {
  const peak = Math.max(1, ...series)
  return (
    <span aria-hidden className="flex h-5 items-end gap-px">
      {series.map((count, day) => (
        <span
          key={day}
          className={cn('w-[3px] rounded-t-[1px]', count ? 'bg-heat-3' : 'bg-heat-0')}
          style={{ height: count ? `${Math.max(15, (count / peak) * 100)}%` : '2px' }}
        />
      ))}
    </span>
  )
}

function ProjectCard({ project, recency }: { project: ProjectSummary; recency?: ProjectRecency }) {
  const { run, stop, restart } = useProjectActions(project.id)
  const mainRuns = project.runs.filter((r) => r.worktree === project.path && r.kind === 'service')
  const activeMain = mainRuns.filter(isActive)
  const status = overallStatus(project.runs)
  const openUrl = activeMain.find((r) => r.url && r.status === 'running')?.url
  const runnable = project.serviceNames.length > 0

  return (
    <Panel className="group relative flex flex-col p-4 transition hover:border-border-strong">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {project.group && (
            <p className="truncate font-mono text-[11px] text-faint">{project.group}/</p>
          )}
          <h3 className="truncate text-[15px] font-semibold tracking-tight">
            <Link to={`/p/${project.id}`} className="after:absolute after:inset-0">
              {project.name}
            </Link>
          </h3>
        </div>
        {status !== 'idle' && status !== 'exited' && <StatusPill status={status} />}
      </div>

      <p
        className={cn(
          'mt-1.5 line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3] text-muted',
          !project.description && 'italic text-faint',
        )}
      >
        {project.description ?? 'No description yet'}
      </p>

      {project.stack.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {project.stack.slice(0, 5).map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
          {project.stack.length > 5 && <Chip>+{project.stack.length - 5}</Chip>}
        </div>
      )}

      {recency && (
        <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
          <span>
            <span className="font-medium text-text tabular-nums">{recency.commits}</span>{' '}
            {recency.commits === 1 ? 'commit' : 'commits'} · 30d
          </span>
          <Sparkline series={recency.series} />
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4 text-[12px] text-muted">
        <span className="flex min-w-0 items-center gap-1 font-mono">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{project.git.branch ?? 'detached'}</span>
        </span>
        {project.worktrees.length > 1 && (
          <span className="shrink-0 text-faint">+{project.worktrees.length - 1} wt</span>
        )}
        {project.uncommitted.length > 0 && (
          <span
            className="shrink-0 text-warn"
            title={project.uncommitted
              .map((wt) => `${wt.branch ?? 'detached HEAD'}: ${wt.dirty} changed`)
              .join('\n')}
          >
            {project.uncommitted.reduce((sum, wt) => sum + wt.dirty, 0)} changed
          </span>
        )}
        <span className="shrink-0 truncate text-faint">{timeAgo(project.git.committedAt)}</span>

        {/* Buttons sit above the card's full-size link. */}
        <span className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5">
          {runnable &&
            (activeMain.length > 0 ? (
              <>
                <Button
                  size="sm"
                  icon={<RotateCw className="size-3" />}
                  busy={restart.isPending}
                  title="Restart with the current configuration"
                  onClick={() => restart.mutate({ worktree: project.path })}
                >
                  Restart
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Square className="size-3" />}
                  busy={stop.isPending}
                  onClick={() => stop.mutate({ worktree: project.path })}
                >
                  Stop
                </Button>
              </>
            ) : project.needsInstall ? (
              <Link
                to={`/p/${project.id}`}
                title="Dependencies are missing in this checkout"
                className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-[12.5px] font-medium hover:border-border-strong hover:bg-surface-2"
              >
                Set up
              </Link>
            ) : (
              <Button
                size="sm"
                variant="run"
                icon={<Play className="size-3" />}
                busy={run.isPending}
                onClick={() => run.mutate({ worktree: project.path })}
              >
                Run
              </Button>
            ))}
          {(project.hasPage || openUrl) && (
            <OpenButton
              url={openUrl ?? null}
              label="Open"
              waitingTitle={activeMain.length ? 'Waiting for the server…' : 'Starts with Run'}
            />
          )}
        </span>
      </div>
    </Panel>
  )
}

export function Overview() {
  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects,
    refetchInterval: PROJECT_POLL_MS,
  })

  const { data: activity } = useQuery({
    queryKey: ['activity', 'all'],
    queryFn: () => api.activity(),
  })

  if (isLoading) return <p className="p-8 text-muted">Scanning ~/GitHub…</p>
  if (error) return <p className="p-8 text-bad">Could not load projects: {error.message}</p>
  if (!projects) return null

  const running = projects.flatMap((project) =>
    project.runs
      .filter((r) => r.kind === 'service' && isActive(r))
      .map((run) => ({ project, run })),
  )
  const dirty = projects.filter((p) => p.uncommitted.length > 0).length
  const byId = new Map(projects.map((project) => [project.id, project]))
  const active = mostActive(activity?.byProject ?? {}, MOST_ACTIVE_COUNT).flatMap((recency) => {
    const project = byId.get(recency.projectId)
    return project ? [{ project, recency }] : []
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Overview</h1>
        <p className="mt-1 text-[14px] text-muted">
          {projects.length} projects · {running.length} running · {dirty} with uncommitted changes
        </p>
      </header>

      <div className="mt-6">
        <NeedsAttention projects={projects} />
      </div>

      {running.length > 0 && (
        <Panel className="mt-6">
          <h2 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">
            Running now
          </h2>
          <ul className="divide-y divide-border text-[13.5px]">
            {running.map(({ project, run }) => (
              <RunningRow key={run.id} project={project} run={run} />
            ))}
          </ul>
        </Panel>
      )}

      {active.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold">
            Most active projects
            <span className="text-[12px] font-normal text-faint">
              {plural(active.length, 'project')} by commits in the last 30 days
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map(({ project, recency }) => (
              <ProjectCard key={project.id} project={project} recency={recency} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-8">
        <ActivitySection />
      </div>
    </div>
  )
}
