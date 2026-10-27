import { describe, expect, it } from 'vitest'
import {
  activityStats,
  buildGrid,
  commitsByStack,
  dayKey,
  levelScale,
  mostActive,
  parseDay,
} from './activity.ts'

describe('buildGrid', () => {
  it('pads a year out to whole Sunday-first weeks', () => {
    // 2026-01-01 is a Thursday; 2026-12-31 is a Thursday.
    const grid = buildGrid({ kind: 'year', year: 2026 })
    expect(grid.weeks[0].map((c) => c.date)).toEqual([
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ])
    expect(grid.weeks[0].map((c) => c.inRange)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ])
    expect(grid.weeks.at(-1)?.at(-1)).toEqual({ date: '2027-01-02', inRange: false })
    expect(grid.dates).toHaveLength(365)
    expect(grid.dates[0]).toBe('2026-01-01')
    expect(grid.months.map((m) => m.label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ])
  })

  it('includes Feb 29 in a leap year', () => {
    const grid = buildGrid({ kind: 'year', year: 2028 })
    expect(grid.dates).toHaveLength(366)
    expect(grid.dates).toContain('2028-02-29')
  })

  it('ends the rolling range today, after 52 full weeks', () => {
    const today = new Date(2026, 9, 22) // a Thursday
    const grid = buildGrid({ kind: 'rolling' }, today)
    expect(grid.weeks).toHaveLength(53)
    expect(grid.weeks[0][0]).toEqual({ date: '2025-10-19', inRange: true })
    expect(grid.dates.at(-1)).toBe('2026-10-22')
    // Friday and Saturday of this week haven't happened.
    expect(grid.weeks[52].map((c) => c.inRange)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ])
    expect(grid.months[0].label).toBe('Nov')
  })
})

describe('levelScale', () => {
  it('splits active days into quartiles and keeps zero at level 0', () => {
    const level = levelScale([0, 1, 2, 3, 4, 5, 6, 7, 8, 40])
    expect([0, 1, 4, 6, 8, 40].map(level)).toEqual([0, 1, 2, 3, 4, 4])
  })

  it('handles a history with a single active day', () => {
    const level = levelScale([0, 0, 3])
    expect(level(3)).toBe(1)
    expect(level(0)).toBe(0)
  })
})

describe('activityStats', () => {
  const today = new Date(2026, 9, 22) // Thursday
  const counts: Record<string, number> = {
    '2026-10-10': 1,
    '2026-10-11': 2,
    '2026-10-12': 9,
    '2026-10-13': 1,
    '2026-10-19': 1,
    '2026-10-20': 2,
    '2026-10-21': 1,
  }
  const countFor = (date: string) => counts[date] ?? 0
  const dates = Array.from({ length: 30 }, (_, i) => dayKey(new Date(2026, 8, 23 + i)))

  it('counts the current streak through yesterday when today has nothing yet', () => {
    const stats = activityStats(countFor, dates, today)
    expect(stats.currentStreak).toBe(3)
    expect(stats.longestStreak).toBe(4)
    expect(stats.busiest).toEqual({ date: '2026-10-12', count: 9 })
    expect(stats.total).toBe(17)
    // Sunday 18th through Thursday 22nd.
    expect(stats.thisWeek).toBe(4)
  })

  it('breaks the streak after a missed day', () => {
    const stats = activityStats(countFor, dates, new Date(2026, 9, 23))
    expect(stats.currentStreak).toBe(0)
  })

  it('is all zeros for an empty history', () => {
    expect(activityStats(() => 0, dates, today)).toEqual({
      total: 0,
      currentStreak: 0,
      longestStreak: 0,
      busiest: null,
      thisWeek: 0,
    })
  })
})

describe('parseDay', () => {
  it('round-trips with dayKey in local time', () => {
    expect(dayKey(parseDay('2026-03-08'))).toBe('2026-03-08')
  })
})

describe('mostActive', () => {
  const today = new Date(2026, 9, 23)

  it('ranks by commits in the last 30 days, then by the latest commit', () => {
    const ranked = mostActive(
      {
        busy: { '2026-10-20': 3, '2026-10-01': 2 },
        recent: { '2026-10-22': 5 },
        older: { '2026-10-02': 5 },
        // Day 31 back is outside the window; the project is left out.
        stale: { '2026-09-22': 9 },
      },
      6,
      today,
    )
    expect(ranked.map((p) => [p.projectId, p.commits, p.lastDay])).toEqual([
      ['recent', 5, '2026-10-22'],
      ['busy', 5, '2026-10-20'],
      ['older', 5, '2026-10-02'],
    ])
  })

  it('includes the window edges, keeps a series per day, and honours the limit', () => {
    const [first, ...rest] = mostActive(
      { a: { '2026-09-24': 1, '2026-10-23': 2 }, b: { '2026-10-23': 1 } },
      2,
      today,
    )
    expect(first.projectId).toBe('a')
    expect(first.series).toHaveLength(30)
    expect([first.series[0], first.series[29]]).toEqual([1, 2])
    expect(rest).toHaveLength(1)
    expect(mostActive({ a: { '2026-10-23': 1 } }, 0, today)).toEqual([])
  })
})

describe('commitsByStack', () => {
  it('buckets commits by project stack for each week and ignores days outside the range', () => {
    const grid = buildGrid({ kind: 'year', year: 2026 })
    const result = commitsByStack(
      {
        web: { '2026-01-05': 2, '2026-01-06': 1, '2025-12-31': 7 },
        api: { '2026-01-06': 4 },
        mystery: { '2026-01-13': 1 },
      },
      (id) => ({ web: 'Next.js', api: 'Python' })[id],
      grid,
    )
    expect(result.total).toBe(8)
    expect(result.stacks).toEqual([
      { name: 'Python', total: 4 },
      { name: 'Next.js', total: 3 },
      { name: 'Other', total: 1 },
    ])
    // 2026-01-04 is the Sunday that starts the week with Jan 5 and 6.
    const week = result.weeks.find((w) => w.start === '2026-01-04')
    expect(week?.counts).toEqual({ 'Next.js': 3, Python: 4 })
  })
})
