import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { getConfig } from './config.ts'
import { projectName, type Repo } from './discovery.ts'
import { toWebUrl } from './git.ts'
import type {
  ActivityDay,
  ActivityScope,
  ActivitySummary,
  DayCommit,
  Visibility,
} from '../shared/types.ts'

const execFileAsync = promisify(execFile)

const COMMIT_FORMAT = '--format=%H%x00%ae%x00%at%x00%s'
const REPO_CONCURRENCY = 6
const VISIBILITY_TIMEOUT_MS = 15_000

interface RepoCommit {
  hash: string
  /** Author date in ms, like GitHub's contribution graph. */
  at: number
  subject: string
  local: boolean
  pushed: boolean
}

interface RepoActivity {
  /** Changes whenever a branch, an origin branch or the author emails change. */
  fingerprint: string
  /** Lowercased emails whose commits count as yours in this repo. */
  emails: string[]
  commits: RepoCommit[]
  /** `owner/repo` when origin is on github.com. */
  github: string | null
  hasOrigin: boolean
}

export type VisibilityLookup = (ownerRepo: string) => Promise<Visibility>

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/** Asks GitHub through `gh`; anything that goes wrong (no gh, no access, offline) is "unknown". */
export const ghVisibility: VisibilityLookup = async (ownerRepo) => {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', ownerRepo, '--json', 'visibility', '--jq', '.visibility'],
      { timeout: VISIBILITY_TIMEOUT_MS },
    )
    const value = stdout.trim().toLowerCase()
    if (value === 'public') return 'public'
    // GitHub's "internal" repos aren't visible to the public either.
    if (value === 'private' || value === 'internal') return 'private'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export function githubRepoOf(remote: string): string | null {
  const web = toWebUrl(remote)
  const match = web && /^https:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+?)\/?$/.exec(web)
  return match ? match[1] : null
}

/** `YYYY-MM-DD` in the hub's local time zone, which is the browser's too (same machine). */
export function localDay(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseCommits(out: string | null, emails: Set<string>): Omit<RepoCommit, 'pushed'>[] {
  if (!out) return []
  const commits: Omit<RepoCommit, 'pushed'>[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [hash, email, at, subject] = line.split('\0')
    if (!emails.has(email.toLowerCase())) continue
    commits.push({ hash, at: Number(at) * 1000, subject: subject ?? '', local: true })
  }
  return commits
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Your commits across every repo, bucketed by day. Each repo's commit list is cached until its
 * refs change, so a refresh where nothing moved costs one `for-each-ref` per repo.
 */
export class ActivityIndex {
  private repos = new Map<string, RepoActivity>()
  private visibility = new Map<string, Visibility>()
  private visibilityFile: string | null
  private lookup: VisibilityLookup

  constructor(options: { visibilityFile?: string | null; lookup?: VisibilityLookup } = {}) {
    this.visibilityFile = options.visibilityFile ?? null
    this.lookup = options.lookup ?? ghVisibility
    this.loadVisibility()
  }

  /** Repos can be made public or private at any time; called after each fetch of every repo. */
  forgetVisibility(): void {
    this.visibility.clear()
  }

  async summary(repos: Repo[]): Promise<ActivitySummary> {
    const { entries, authorEmails } = await this.collect(repos)
    const days: Record<string, ActivityDay> = {}
    const byProject: Record<string, Record<string, number>> = {}
    for (const { repo, commit, visibility } of entries) {
      const key = localDay(commit.at)
      const day = (days[key] ??= { local: 0, pushed: 0, public: 0, private: 0 })
      if (commit.local) {
        const perDay = (byProject[repo.id] ??= {})
        perDay[key] = (perDay[key] ?? 0) + 1
        day.local++
      }
      if (commit.pushed) {
        day.pushed++
        if (visibility === 'public') day.public++
        if (visibility === 'private') day.private++
      }
    }
    const years = [...new Set(Object.keys(days).map((key) => Number(key.slice(0, 4))))].sort(
      (a, b) => b - a,
    )
    const activities = repos.map((repo) => this.repos.get(repo.path))
    const visibilities = activities.map((a) => (a?.github ? this.visibility.get(a.github) : null))
    return {
      days,
      years,
      byProject,
      totals: {
        projects: repos.length,
        withRemote: activities.filter((a) => a?.hasOrigin).length,
        public: visibilities.filter((v) => v === 'public').length,
        private: visibilities.filter((v) => v === 'private').length,
      },
      authorEmails,
    }
  }

  async day(repos: Repo[], date: string, scope: ActivityScope): Promise<DayCommit[]> {
    const { entries } = await this.collect(repos)
    return entries
      .filter(({ commit }) => commit[scope] && localDay(commit.at) === date)
      .sort((a, b) => b.commit.at - a.commit.at)
      .map(({ repo, commit, visibility }) => ({
        projectId: repo.id,
        projectName: projectName(repo),
        hash: commit.hash,
        short: commit.hash.slice(0, 7),
        subject: commit.subject,
        at: commit.at,
        local: commit.local,
        pushed: commit.pushed,
        visibility,
      }))
  }

  /**
   * Every commit once, owned by the first repo (in `repos` order) that has it, so two clones of
   * the same repo don't double-count. A commit's flags are merged across the repos that have it.
   */
  private async collect(repos: Repo[]) {
    const globalEmail = (await git(process.cwd(), ['config', '--global', 'user.email']))?.trim()
    const extra = getConfig().activity.authorEmails ?? []
    const activities = await mapLimit(repos, REPO_CONCURRENCY, (repo) =>
      this.load(repo, [globalEmail ?? '', ...extra]),
    )
    await this.resolveVisibility(activities)

    const seen = new Map<string, { repo: Repo; commit: RepoCommit; visibility: Visibility }>()
    const emails = new Set<string>()
    repos.forEach((repo, index) => {
      const activity = activities[index]
      for (const email of activity.emails) emails.add(email)
      const visibility = activity.github
        ? (this.visibility.get(activity.github) ?? 'unknown')
        : 'unknown'
      for (const commit of activity.commits) {
        const existing = seen.get(commit.hash)
        if (existing) {
          existing.commit = {
            ...existing.commit,
            local: existing.commit.local || commit.local,
            pushed: existing.commit.pushed || commit.pushed,
          }
        } else {
          seen.set(commit.hash, { repo, commit, visibility })
        }
      }
    })
    return { entries: [...seen.values()], authorEmails: [...emails].sort() }
  }

  private async load(repo: Repo, baseEmails: string[]): Promise<RepoActivity> {
    const [repoEmail, refs, remote] = await Promise.all([
      git(repo.path, ['config', 'user.email']),
      git(repo.path, [
        'for-each-ref',
        '--format=%(objectname) %(refname)',
        'refs/heads',
        'refs/remotes/origin',
      ]),
      git(repo.path, ['config', '--get', 'remote.origin.url']),
    ])
    const emails = [...new Set([repoEmail ?? '', ...baseEmails].map((e) => e.trim().toLowerCase()))]
      .filter(Boolean)
      .sort()
    const fingerprint = `${emails.join(',')}\n${refs ?? ''}`
    const cached = this.repos.get(repo.path)
    if (cached?.fingerprint === fingerprint) return cached

    const emailSet = new Set(emails)
    const [localLog, remoteOnlyLog, pushedList] = await Promise.all([
      git(repo.path, ['log', COMMIT_FORMAT, '--branches']),
      // Pushed from somewhere else and not pulled here: on origin, but on no local branch.
      git(repo.path, ['log', COMMIT_FORMAT, '--remotes=origin', '--not', '--branches']),
      git(repo.path, ['rev-list', '--remotes=origin']),
    ])
    const pushed = new Set(pushedList?.split('\n').filter(Boolean))
    const commits: RepoCommit[] = [
      ...parseCommits(localLog, emailSet).map((c) => ({ ...c, pushed: pushed.has(c.hash) })),
      ...parseCommits(remoteOnlyLog, emailSet).map((c) => ({ ...c, local: false, pushed: true })),
    ]
    const activity: RepoActivity = {
      fingerprint,
      emails,
      commits,
      github: remote ? githubRepoOf(remote) : null,
      hasOrigin: Boolean(remote?.trim()),
    }
    this.repos.set(repo.path, activity)
    return activity
  }

  private async resolveVisibility(activities: RepoActivity[]): Promise<void> {
    const missing = [
      ...new Set(
        activities.flatMap((a) => (a.github && !this.visibility.has(a.github) ? [a.github] : [])),
      ),
    ]
    if (missing.length === 0) return
    const found = await mapLimit(missing, REPO_CONCURRENCY, this.lookup)
    missing.forEach((ownerRepo, index) => this.visibility.set(ownerRepo, found[index]))
    this.saveVisibility()
  }

  private loadVisibility(): void {
    if (!this.visibilityFile) return
    try {
      const saved = JSON.parse(readFileSync(this.visibilityFile, 'utf8')) as Record<
        string,
        Visibility
      >
      for (const [ownerRepo, value] of Object.entries(saved)) {
        // "unknown" usually means gh failed; it's worth asking again next run.
        if (value !== 'unknown') this.visibility.set(ownerRepo, value)
      }
    } catch {
      // No cache yet.
    }
  }

  private saveVisibility(): void {
    if (!this.visibilityFile) return
    try {
      mkdirSync(dirname(this.visibilityFile), { recursive: true })
      writeFileSync(
        this.visibilityFile,
        JSON.stringify(Object.fromEntries(this.visibility), null, 2),
      )
    } catch (error) {
      console.error(
        `[project-explorer] could not write ${this.visibilityFile}: ${(error as Error).message}`,
      )
    }
  }
}

export function activityRepos(repos: Repo[], projectId: string | undefined): Repo[] {
  return projectId ? repos.filter((repo) => repo.id === projectId) : repos
}
