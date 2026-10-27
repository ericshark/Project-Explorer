import type { RunInfo, RunStatus } from '../../../shared/types.ts'

export function timeAgo(ms: number | null): string {
  if (!ms) return ''
  const steps: [number, string][] = [
    [60, 's'],
    [60, 'm'],
    [24, 'h'],
    [7, 'd'],
    [4.35, 'w'],
    [12, 'mo'],
    [Infinity, 'y'],
  ]
  let value = Math.max(0, (Date.now() - ms) / 1000)
  for (const [size, unit] of steps) {
    if (value < size) return unit === 's' ? 'just now' : `${Math.floor(value)}${unit} ago`
    value /= size
  }
  return ''
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Relative time, with the date and time added once a commit is more than two days old. */
export function commitTime(ms: number, now = Date.now()): string {
  const relative = timeAgo(ms)
  return now - ms > TWO_DAYS_MS ? `${relative} · ${fullDate(ms)}` : relative
}

export function tildify(path: string, home: string | undefined): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function isActive(run: RunInfo): boolean {
  return run.status === 'starting' || run.status === 'running' || run.status === 'stopping'
}

export type Health = RunStatus | 'idle'

/** One status for a set of runs: a failure outranks everything, then in-flight states. */
export function overallStatus(runs: RunInfo[]): Health {
  const services = runs.filter((run) => run.kind === 'service')
  for (const status of ['failed', 'starting', 'stopping', 'running'] as const) {
    if (services.some((run) => run.status === status)) return status
  }
  return 'idle'
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
