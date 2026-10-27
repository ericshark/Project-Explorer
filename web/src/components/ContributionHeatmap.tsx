import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatDay, levelScale, type ActivityGrid, type Level } from '../lib/activity.ts'
import { plural } from '../lib/branches.ts'
import { cn } from '../lib/format.ts'

const LEVEL_CLASS: Record<Level, string> = {
  0: 'bg-heat-0',
  1: 'bg-heat-1',
  2: 'bg-heat-2',
  3: 'bg-heat-3',
  4: 'bg-heat-4',
}
// GitHub labels every other row; all seven would crowd 11px cells.
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']
const CELL = 10
/** Cells stop growing here, so the charts stay compact on wide screens. */
const MAX_CELL = 11
const GAP = 3
const LABEL_WIDTH = 28
const TOOLTIP_HALF_WIDTH = 120

interface ContributionHeatmapProps {
  grid: ActivityGrid
  countFor: (date: string) => number
  /** Extra tooltip text for a day with commits, e.g. "3 public, 2 private". */
  detailFor?: (date: string) => string | null
  selected: string | null
  onSelectDay: (date: string) => void
  /** Names the chart for screen readers. */
  label: string
}

/** GitHub-style grid of days, one column per week, shaded by how many commits each day has. */
export function ContributionHeatmap({
  grid,
  countFor,
  detailFor,
  selected,
  onSelectDay,
  label,
}: ContributionHeatmapProps) {
  const level = useMemo(() => levelScale(grid.dates.map(countFor)), [grid, countFor])
  const [hover, setHover] = useState<{ date: string; left: number; top: number } | null>(null)
  // One cell is in the tab order; arrow keys move it, like any other grid widget.
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())

  // On a narrow screen the newest weeks are what matters, so start scrolled to the end.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [grid])

  const tabbable = focusDate ?? selected ?? grid.dates.at(-1) ?? null

  const describe = (date: string) => {
    const count = countFor(date)
    const detail = count > 0 ? detailFor?.(date) : null
    return `${count ? plural(count, 'commit') : 'No commits'} on ${formatDay(date)}${detail ? ` · ${detail}` : ''}`
  }

  const showTooltip = (date: string, target: HTMLElement) => {
    const box = scrollRef.current?.parentElement?.getBoundingClientRect()
    const cell = target.getBoundingClientRect()
    if (!box) return
    // Kept clear of the edges so a tooltip on the first or last week isn't cut off.
    const center = cell.left - box.left + cell.width / 2
    const left = Math.min(Math.max(center, TOOLTIP_HALF_WIDTH), box.width - TOOLTIP_HALF_WIDTH)
    setHover({ date, left, top: cell.top - box.top })
  }

  const onKeyDown = (event: KeyboardEvent, date: string) => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = grid.dates[grid.dates.indexOf(date) + step]
    if (!next) return
    setFocusDate(next)
    const cell = cellRefs.current.get(next)
    cell?.focus()
    if (cell) showTooltip(next, cell)
  }

  return (
    <div className="relative">
      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div
          role="grid"
          aria-label={label}
          className="grid"
          // Cells size between CELL and MAX_CELL with the panel; narrower than that, the grid scrolls.
          style={{
            gridTemplateColumns: `${LABEL_WIDTH}px repeat(${grid.weeks.length}, minmax(${CELL}px, ${MAX_CELL}px))`,
            gridTemplateRows: `14px repeat(7, auto)`,
            gap: GAP,
            minWidth: LABEL_WIDTH + grid.weeks.length * (CELL + GAP),
          }}
        >
          {grid.months.map((month) => (
            <span
              key={`${month.label}-${month.week}`}
              aria-hidden
              className="text-[10.5px] leading-none whitespace-nowrap text-muted"
              style={{ gridColumn: month.week + 2, gridRow: 1 }}
            >
              {month.label}
            </span>
          ))}
          {WEEKDAY_LABELS.map((day, row) => (
            <span
              key={row}
              aria-hidden
              // Pinned so the weekdays stay visible while narrow screens scroll the weeks; the
              // shadow covers the gaps so cells don't peek through as they pass underneath.
              className="sticky left-0 z-10 flex items-center bg-surface text-[10px] text-faint"
              style={{
                gridColumn: 1,
                gridRow: row + 2,
                boxShadow: `${GAP}px 0 0 var(--surface), 0 ${GAP}px 0 var(--surface), ${GAP}px ${GAP}px 0 var(--surface)`,
              }}
            >
              {day}
            </span>
          ))}
          {grid.weeks.map((week, column) =>
            week.map((cell, row) =>
              cell.inRange ? (
                <button
                  key={cell.date}
                  ref={(el) => {
                    if (el) cellRefs.current.set(cell.date, el)
                    else cellRefs.current.delete(cell.date)
                  }}
                  type="button"
                  role="gridcell"
                  tabIndex={cell.date === tabbable ? 0 : -1}
                  aria-label={describe(cell.date)}
                  aria-selected={cell.date === selected}
                  onClick={() => onSelectDay(cell.date)}
                  onKeyDown={(event) => onKeyDown(event, cell.date)}
                  onMouseEnter={(event) => showTooltip(cell.date, event.currentTarget)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={(event) => {
                    setFocusDate(cell.date)
                    showTooltip(cell.date, event.currentTarget)
                  }}
                  onBlur={() => setHover(null)}
                  className={cn(
                    'aspect-square cursor-pointer rounded-[2px] outline-offset-1',
                    LEVEL_CLASS[level(countFor(cell.date))],
                    cell.date === selected && 'ring-2 ring-text ring-offset-1 ring-offset-surface',
                  )}
                  style={{ gridColumn: column + 2, gridRow: row + 2 }}
                />
              ) : null,
            ),
          )}
        </div>
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md bg-accent px-2 py-1 text-[12px] whitespace-nowrap text-accent-text shadow-lg"
          style={{ left: hover.left, top: hover.top - 6 }}
        >
          {describe(hover.date)}
        </div>
      )}
    </div>
  )
}

/** "Less ▢▢▢▢▢ More", sized to the smallest cell; sits in the chart's title row. */
export function HeatLegend({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex items-center gap-[3px] text-[10.5px] text-muted', className)}
    >
      <span className="mr-1">Less</span>
      {([0, 1, 2, 3, 4] as const).map((l) => (
        <span
          key={l}
          className={cn('rounded-[2px]', LEVEL_CLASS[l])}
          style={{ width: CELL, height: CELL }}
        />
      ))}
      <span className="ml-1">More</span>
    </span>
  )
}
