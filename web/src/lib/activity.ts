export type ActivityRange = { kind: 'rolling' } | { kind: 'year'; year: number }

export interface GridCell {
  /** `YYYY-MM-DD`, local time. */
  date: string
  /** False for padding days before or after the range; those render blank. */
  inRange: boolean
}

export interface ActivityGrid {
  /** One column per week, Sunday first, seven cells each. */
  weeks: GridCell[][]
  /** Month names placed at the week column where that month starts. */
  months: { label: string; week: number }[]
  /** The in-range dates, oldest first. */
  dates: string[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Closer than this and two month labels would overlap. */
const MIN_LABEL_GAP_WEEKS = 3

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parses a `YYYY-MM-DD` key as local midnight. */
export function parseDay(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** "Tue, Oct 21, 2026". */
export function formatDay(date: string): string {
  return parseDay(date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function addDays(date: Date, days: number): Date {
  // Calendar arithmetic rather than adding milliseconds, so DST changes can't skip a day.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/**
 * Week columns like GitHub's graph: the rolling range is the 52 full weeks before this one plus
 * this week up to today; a year range is Jan 1 to Dec 31, padded out to whole weeks.
 */
export function buildGrid(range: ActivityRange, today = new Date()): ActivityGrid {
  const first =
    range.kind === 'year' ? new Date(range.year, 0, 1) : addDays(today, -today.getDay() - 52 * 7)
  const last = range.kind === 'year' ? new Date(range.year, 11, 31) : today
  const firstKey = dayKey(first)
  const lastKey = dayKey(last)

  const weeks: GridCell[][] = []
  const months: ActivityGrid['months'] = []
  const dates: string[] = []
  for (let start = addDays(first, -first.getDay()); dayKey(start) <= lastKey;) {
    const week: GridCell[] = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i)
      const key = dayKey(date)
      const inRange = key >= firstKey && key <= lastKey
      week.push({ date: key, inRange })
      if (!inRange) continue
      dates.push(key)
      if (date.getDate() === 1 || key === firstKey) {
        const previous = months.at(-1)
        const label = MONTHS[date.getMonth()]
        if (previous && weeks.length - previous.week < MIN_LABEL_GAP_WEEKS) {
          // A partial first month gives way to the full month that follows it.
          if (previous.week === 0) months[months.length - 1] = { label, week: weeks.length }
        } else {
          months.push({ label, week: weeks.length })
        }
      }
    }
    weeks.push(week)
    start = addDays(start, 7)
  }
  return { weeks, months, dates }
}

export type Level = 0 | 1 | 2 | 3 | 4

/**
 * Maps counts to five shades by the quartiles of the active days, so one huge day doesn't wash
 * every other day out to the palest green.
 */
export function levelScale(counts: number[]): (count: number) => Level {
  const active = counts.filter((count) => count > 0).sort((a, b) => a - b)
  const quantile = (q: number) => active[Math.max(0, Math.ceil(q * active.length) - 1)] ?? 0
  const [q1, q2, q3] = [quantile(0.25), quantile(0.5), quantile(0.75)]
  return (count) => {
    if (count <= 0) return 0
    if (count <= q1) return 1
    if (count <= q2) return 2
    if (count <= q3) return 3
    return 4
  }
}

export interface ActivityStats {
  total: number
  /** Consecutive days with commits ending today, or yesterday when today has none yet. */
  currentStreak: number
  longestStreak: number
  busiest: { date: string; count: number } | null
  /** Since Sunday. */
  thisWeek: number
}

/** `dates` bounds the totals and longest streak; the current streak always runs up to today. */
export function activityStats(
  countFor: (date: string) => number,
  dates: string[],
  today = new Date(),
): ActivityStats {
  let total = 0
  let longestStreak = 0
  let run = 0
  let busiest: ActivityStats['busiest'] = null
  for (const date of dates) {
    const count = countFor(date)
    total += count
    run = count > 0 ? run + 1 : 0
    longestStreak = Math.max(longestStreak, run)
    if (count > 0 && (!busiest || count > busiest.count)) busiest = { date, count }
  }

  // Today not having commits yet doesn't break the streak until the day is over.
  let day = countFor(dayKey(today)) > 0 ? today : addDays(today, -1)
  let currentStreak = 0
  while (countFor(dayKey(day)) > 0) {
    currentStreak++
    day = addDays(day, -1)
  }

  let thisWeek = 0
  for (let i = 0; i <= today.getDay(); i++) thisWeek += countFor(dayKey(addDays(today, -i)))

  return { total, currentStreak, longestStreak, busiest, thisWeek }
}

/** Local commits per day, keyed by project id. */
export type ByProject = Record<string, Record<string, number>>

export const RECENT_DAYS = 30

export interface ProjectRecency {
  projectId: string
  commits: number
  /** Latest day with a commit in the window; breaks ties between equally busy projects. */
  lastDay: string
  /** Commits per day, oldest first, one entry for each of the last `RECENT_DAYS` days. */
  series: number[]
}

/** The projects with the most commits in the last 30 days; projects with none are left out. */
export function mostActive(
  byProject: ByProject,
  limit: number,
  today = new Date(),
): ProjectRecency[] {
  const dates = Array.from({ length: RECENT_DAYS }, (_, i) =>
    dayKey(addDays(today, i - (RECENT_DAYS - 1))),
  )
  const ranked: ProjectRecency[] = []
  for (const [projectId, days] of Object.entries(byProject)) {
    const series = dates.map((date) => days[date] ?? 0)
    const commits = series.reduce((sum, count) => sum + count, 0)
    if (commits === 0) continue
    ranked.push({ projectId, commits, lastDay: dates[series.findLastIndex((n) => n > 0)], series })
  }
  return ranked
    .sort(
      (a, b) =>
        b.commits - a.commits ||
        b.lastDay.localeCompare(a.lastDay) ||
        a.projectId.localeCompare(b.projectId),
    )
    .slice(0, limit)
}

export interface StackBreakdown {
  /** Busiest first. */
  stacks: { name: string; total: number }[]
  /** One entry per week column of the grid, with that week's commits per stack. */
  weeks: { start: string; counts: Record<string, number> }[]
  total: number
}

/** Groups the commits inside the grid's range by the stack bucket of their project. */
export function commitsByStack(
  byProject: ByProject,
  stackOf: (projectId: string) => string | undefined,
  grid: ActivityGrid,
): StackBreakdown {
  const totals = new Map<string, number>()
  const weeks = grid.weeks.map((week) => {
    const counts: Record<string, number> = {}
    for (const { date, inRange } of week) {
      if (!inRange) continue
      for (const [projectId, days] of Object.entries(byProject)) {
        const count = days[date]
        if (!count) continue
        const stack = stackOf(projectId) ?? 'Other'
        counts[stack] = (counts[stack] ?? 0) + count
        totals.set(stack, (totals.get(stack) ?? 0) + count)
      }
    }
    return { start: week[0].date, counts }
  })
  const stacks = [...totals]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return { stacks, weeks, total: stacks.reduce((sum, stack) => sum + stack.total, 0) }
}
