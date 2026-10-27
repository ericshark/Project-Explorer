import { useMutation, useQuery } from '@tanstack/react-query'
import { RefreshCw, X } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityScope, ActivitySummary } from '../../../shared/types.ts'
import { activityStats, buildGrid, formatDay, type ActivityRange } from '../lib/activity.ts'
import { api } from '../lib/api.ts'
import { plural } from '../lib/branches.ts'
import { cn, timeAgo } from '../lib/format.ts'
import { toastError } from '../lib/toast.ts'
import { ContributionHeatmap, HeatLegend } from './ContributionHeatmap.tsx'
import { StackBreakdown } from './StackBreakdown.tsx'
import { useSettings } from '../lib/settings.ts'
import { Button, Chip, CollapsiblePanel, Panel } from './ui.tsx'

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-1.5">
      <p className="truncate text-[11.5px] text-muted">{label}</p>
      <p className="text-[17px] leading-tight font-semibold tracking-tight tabular-nums">{value}</p>
      {note && <p className="truncate text-[11.5px] text-faint">{note}</p>}
    </div>
  )
}

function RangePicker({
  years,
  range,
  onChange,
}: {
  years: number[]
  range: ActivityRange
  onChange: (range: ActivityRange) => void
}) {
  const options: { key: string; label: string; range: ActivityRange }[] = [
    { key: 'rolling', label: 'Last 12 months', range: { kind: 'rolling' } },
    ...years.map((year) => ({
      key: String(year),
      label: String(year),
      range: { kind: 'year', year } as const,
    })),
  ]
  const current = range.kind === 'rolling' ? 'rolling' : String(range.year)
  return (
    <div role="radiogroup" aria-label="Range" className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={option.key === current}
          onClick={() => onChange(option.range)}
          className={cn(
            'h-7 cursor-pointer rounded-md px-2.5 text-[12.5px] font-medium',
            option.key === current
              ? 'bg-surface-2 text-text'
              : 'text-muted hover:bg-surface-2/60 hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function FetchAllButton() {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const fetchAll = useMutation({
    mutationFn: api.fetchAll,
    onError: toastError,
    onSuccess: ({ failed }) => {
      if (failed.length) toastError(new Error(`Could not fetch ${failed.join(', ')}`))
    },
  })
  const running = fetchAll.isPending || Boolean(meta?.fetch.running)
  return (
    <span className="flex items-center gap-2">
      {meta?.fetch.lastFetchAt && !running && (
        <span className="hidden text-[12px] text-faint sm:inline">
          Fetched {timeAgo(meta.fetch.lastFetchAt)}
        </span>
      )}
      <Button
        size="sm"
        icon={<RefreshCw className="size-3.5" />}
        busy={running}
        title="Fetch every repo's remotes, then recount pushed commits"
        onClick={() => fetchAll.mutate()}
      >
        {running ? 'Fetching…' : 'Fetch all'}
      </Button>
    </span>
  )
}

function DayCommits({
  date,
  scope,
  projectId,
  onClose,
}: {
  date: string
  scope: ActivityScope
  projectId?: string
  onClose: () => void
}) {
  const { data: commits, isLoading } = useQuery({
    queryKey: ['activity', projectId ?? 'all', 'day', date, scope],
    queryFn: () => api.activityDay(date, scope, projectId),
  })
  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{formatDay(date)}</h3>
        <span className="text-[12px] text-muted">
          {commits ? plural(commits.length, 'commit') : ''}
          {scope === 'pushed' ? ' pushed' : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-label="Close day"
          icon={<X className="size-4" />}
          onClick={onClose}
        />
      </div>
      {isLoading ? (
        <p className="px-4 pb-3 text-[13px] text-muted">Loading…</p>
      ) : !commits?.length ? (
        <p className="px-4 pb-3 text-[13px] text-faint">No commits this day.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border text-[13px]">
          {commits.map((commit) => (
            <li
              key={commit.hash}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2"
            >
              {!projectId && (
                <Link
                  to={`/p/${commit.projectId}`}
                  className="shrink-0 font-medium hover:underline"
                >
                  {commit.projectName}
                </Link>
              )}
              <span className="shrink-0 font-mono text-[12px] text-faint">{commit.short}</span>
              <span className="min-w-0 flex-1 basis-48 truncate">{commit.subject}</span>
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-faint">
                {!commit.pushed && <Chip>not pushed</Chip>}
                {commit.pushed && commit.visibility !== 'unknown' && (
                  <Chip>{commit.visibility}</Chip>
                )}
                {new Date(commit.at).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ChartBlock({
  title,
  total,
  note,
  legend = true,
  children,
}: {
  title: string
  total: number
  note?: string
  /** The heat-scale legend; charts with their own legend turn it off. */
  legend?: boolean
  children: ReactNode
}) {
  return (
    // As wide as the grid, so the legend lines up with the grid's right edge.
    <div className={cn('max-w-full min-w-0', legend ? 'w-fit' : 'w-full')}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="text-[12.5px] text-muted tabular-nums">{plural(total, 'commit')}</span>
        {note && <span className="text-[12px] text-faint">{note}</span>}
        {legend && <HeatLegend className="ml-auto" />}
      </div>
      {children}
    </div>
  )
}

function SummaryBody({
  summary,
  range,
  projectId,
}: {
  summary: ActivitySummary
  range: ActivityRange
  projectId?: string
}) {
  const [selected, setSelected] = useState<{ date: string; scope: ActivityScope } | null>(null)
  const grid = useMemo(() => buildGrid(range), [range])

  const localCount = useCallback((date: string) => summary.days[date]?.local ?? 0, [summary])
  const pushedCount = useCallback((date: string) => summary.days[date]?.pushed ?? 0, [summary])
  const pushedDetail = useCallback(
    (date: string) => {
      const day = summary.days[date]
      if (!day || (!day.public && !day.private)) return null
      return [day.public && `${day.public} public`, day.private && `${day.private} private`]
        .filter(Boolean)
        .join(', ')
    },
    [summary],
  )

  const stats = activityStats(localCount, grid.dates)
  const pushedTotal = grid.dates.reduce((sum, date) => sum + pushedCount(date), 0)
  const { totals } = summary
  const remoteNote = projectId
    ? undefined
    : `${plural(totals.withRemote, 'repo')} with a remote · ${totals.public} public · ${totals.private} private`

  const select = (scope: ActivityScope) => (date: string) =>
    setSelected((current) =>
      current?.date === date && current.scope === scope ? null : { date, scope },
    )

  return (
    <>
      <div
        className={cn(
          'grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-3',
          projectId ? 'lg:grid-cols-5' : 'lg:grid-cols-6',
        )}
      >
        <StatTile
          label="Commits"
          value={stats.total.toLocaleString()}
          note={range.kind === 'rolling' ? 'last 12 months' : String(range.year)}
        />
        {!projectId && <StatTile label="Projects" value={String(totals.projects)} />}
        <StatTile label="Current streak" value={plural(stats.currentStreak, 'day')} />
        <StatTile label="Longest streak" value={plural(stats.longestStreak, 'day')} />
        <StatTile
          label="Busiest day"
          value={stats.busiest ? String(stats.busiest.count) : '–'}
          note={stats.busiest ? formatDay(stats.busiest.date) : undefined}
        />
        <StatTile label="This week" value={String(stats.thisWeek)} note="since Sunday" />
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">
        <ChartBlock title="All commits" total={stats.total} note="every local branch">
          <ContributionHeatmap
            label="All commits per day"
            grid={grid}
            countFor={localCount}
            selected={selected?.scope === 'local' ? selected.date : null}
            onSelectDay={select('local')}
          />
        </ChartBlock>
        <ChartBlock title="Pushed" total={pushedTotal} note={remoteNote}>
          <ContributionHeatmap
            label="Pushed commits per day"
            grid={grid}
            countFor={pushedCount}
            detailFor={pushedDetail}
            selected={selected?.scope === 'pushed' ? selected.date : null}
            onSelectDay={select('pushed')}
          />
        </ChartBlock>
        {!projectId && (
          <ChartBlock
            title="By stack"
            total={stats.total}
            note="commits per week, grouped by project type"
            legend={false}
          >
            <StackBreakdown summary={summary} grid={grid} />
          </ChartBlock>
        )}
      </div>

      {selected && (
        <DayCommits
          date={selected.date}
          scope={selected.scope}
          projectId={projectId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function ActivityContent({ projectId, title }: { projectId?: string; title?: string }) {
  const { data: summary, error } = useQuery({
    queryKey: ['activity', projectId ?? 'all'],
    queryFn: () => api.activity(projectId),
  })
  const [range, setRange] = useState<ActivityRange>({ kind: 'rolling' })

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 px-4 py-3',
          title ? 'border-b border-border' : 'border-t border-border',
        )}
      >
        <div className="mr-auto min-w-0">
          {title && <h2 className="text-[14px] font-semibold">{title}</h2>}
          {summary && (
            <p className="truncate text-[12px] text-faint">
              {summary.authorEmails.length
                ? `Commits by ${summary.authorEmails.join(', ')}`
                : 'No git email configured'}
            </p>
          )}
        </div>
        {summary && <RangePicker years={summary.years} range={range} onChange={setRange} />}
        {!projectId && <FetchAllButton />}
      </div>
      {error ? (
        <p className="px-4 py-6 text-[13px] text-bad">Could not load activity: {error.message}</p>
      ) : !summary ? (
        <p className="px-4 py-6 text-[13px] text-muted">Counting commits…</p>
      ) : summary.authorEmails.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted">
          Set <code className="font-mono">git config --global user.email</code>, or list your emails
          under <code className="font-mono">activity.authorEmails</code> in hub.config.json, to see
          your commits here.
        </p>
      ) : (
        // Keyed by range so a selected day from another range doesn't linger.
        <SummaryBody
          key={range.kind === 'rolling' ? 'rolling' : range.year}
          summary={summary}
          range={range}
          projectId={projectId}
        />
      )}
    </>
  )
}

/**
 * Commit heatmaps for every project, or just `projectId`, counting only your own commits.
 * With `collapsible`, the body (and its queries) only exist while the section is expanded.
 */
export function ActivitySection({
  projectId,
  collapsible,
}: {
  projectId?: string
  collapsible?: boolean
}) {
  const { expandActivity } = useSettings()
  if (collapsible) {
    return (
      // Keyed so changing the default in Settings applies to a page that is already open.
      <CollapsiblePanel
        key={String(expandActivity)}
        title="Activity"
        defaultExpanded={expandActivity}
      >
        <ActivityContent projectId={projectId} />
      </CollapsiblePanel>
    )
  }
  return (
    <Panel>
      <ActivityContent projectId={projectId} title="Activity" />
    </Panel>
  )
}
