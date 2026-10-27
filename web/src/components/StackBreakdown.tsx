import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ActivitySummary } from '../../../shared/types.ts'
import { commitsByStack, formatDay, type ActivityGrid } from '../lib/activity.ts'
import { api, PROJECT_POLL_MS } from '../lib/api.ts'
import { plural } from '../lib/branches.ts'
import { cn } from '../lib/format.ts'
import { stackColor } from '../lib/stacks.ts'

const CHART_HEIGHT = 112
/** Space between stacked segments, so adjacent fills never touch. */
const SEGMENT_GAP = 2

/** Weekly commits stacked by the technology stack of the project they landed in. */
export function StackBreakdown({
  summary,
  grid,
}: {
  summary: ActivitySummary
  grid: ActivityGrid
}) {
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects,
    refetchInterval: PROJECT_POLL_MS,
  })
  const [hover, setHover] = useState<number | null>(null)

  const breakdown = useMemo(() => {
    const stackById = new Map(projects?.map((p) => [p.id, p.stackCategory]))
    return commitsByStack(summary.byProject, (id) => stackById.get(id), grid)
  }, [summary, projects, grid])

  if (breakdown.total === 0) {
    return <p className="text-[13px] text-faint">No commits in this range.</p>
  }

  const peak = Math.max(
    1,
    ...breakdown.weeks.map((w) => Object.values(w.counts).reduce((a, b) => a + b, 0)),
  )
  // Stacks are drawn busiest-first from the baseline up.
  const order = breakdown.stacks.map((s) => s.name)
  const active = hover === null ? null : breakdown.weeks[hover]

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="min-w-64 flex-1 basis-96">
        <div
          role="img"
          aria-label="Commits per week by stack"
          className="relative flex items-end gap-px border-b border-border"
          style={{ height: CHART_HEIGHT }}
          onMouseLeave={() => setHover(null)}
        >
          {breakdown.weeks.map((week, index) => {
            const total = Object.values(week.counts).reduce((a, b) => a + b, 0)
            return (
              <div
                key={week.start}
                className="flex h-full min-w-0 flex-1 cursor-default flex-col-reverse"
                onMouseEnter={() => setHover(index)}
              >
                <div
                  className="flex flex-col-reverse"
                  style={{ gap: SEGMENT_GAP, height: `${(total / peak) * 100}%` }}
                >
                  {order
                    .filter((name) => week.counts[name])
                    .map((name) => (
                      <div
                        key={name}
                        className="min-h-px rounded-t-[2px]"
                        style={{
                          flexGrow: week.counts[name],
                          flexBasis: 0,
                          background: stackColor(name),
                        }}
                      />
                    ))}
                </div>
              </div>
            )
          })}
          {active && hover !== null && (
            <div
              className="pointer-events-none absolute z-10 w-max max-w-56 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] shadow-lg"
              style={{
                left: `${((hover + 0.5) / breakdown.weeks.length) * 100}%`,
                bottom: CHART_HEIGHT + 6,
              }}
            >
              <p className="font-medium">Week of {formatDay(active.start)}</p>
              {order
                .filter((name) => active.counts[name])
                .map((name) => (
                  <p key={name} className="flex items-center gap-1.5 text-muted">
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ background: stackColor(name) }}
                    />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto pl-2 text-text tabular-nums">
                      {active.counts[name]}
                    </span>
                  </p>
                ))}
              {Object.keys(active.counts).length === 0 && <p className="text-faint">No commits</p>}
            </div>
          )}
        </div>
      </div>

      <ul className="flex min-w-56 flex-col gap-1 text-[12.5px]">
        {breakdown.stacks.map((stack) => (
          <li key={stack.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: stackColor(stack.name) }}
            />
            <span className="truncate">{stack.name}</span>
            <span className={cn('ml-auto pl-3 text-muted tabular-nums')}>
              {plural(stack.total, 'commit')} · {Math.round((stack.total / breakdown.total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
