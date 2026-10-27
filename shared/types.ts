// Types shared by the hub server and the web UI (the JSON shapes of the API).

export type RunStatus = 'starting' | 'running' | 'stopping' | 'exited' | 'failed'
export type RunKind = 'service' | 'setup'

export interface RunInfo {
  id: string
  projectId: string
  worktree: string
  name: string
  kind: RunKind
  command: string
  cwd: string
  port: number | null
  url: string | null
  status: RunStatus
  exitCode: number | null
  startedAt: number
  endedAt: number | null
}

export interface LogLine {
  stream: 'out' | 'err' | 'sys'
  text: string
}

export interface ServiceDef {
  name: string
  /** Directory relative to the worktree root. */
  cwd?: string
  /** Shell command; `{port}` and `{ports.<service>}` are filled in at launch. */
  command: string
  /** Ports are allocated from `defaultPort + 1` upwards. Omit for services the hub can't re-port. */
  defaultPort?: number
  env?: Record<string, string>
  /** Show an "Open" link for this service (http://localhost:{port} unless `url` is set). */
  open?: boolean
  url?: string
}

export interface SetupStep {
  name: string
  cwd?: string
  command: string
  /** Path (relative to the worktree) this step produces; its absence means the step is needed. */
  creates?: string
}

export interface GitInfo {
  /** null when HEAD is detached. */
  branch: string | null
  head: string | null
  subject: string | null
  committedAt: number | null
  dirty: number
  ahead: number | null
  behind: number | null
}

export interface BranchInfo {
  /** Short name: `main`, or `origin/main` for a remote branch. */
  name: string
  remote: boolean
  head: string
  subject: string
  committedAt: number
  upstream: string | null
  /** Worktree that has this branch checked out (local branches only). */
  checkedOutIn: string | null
  /** Uncommitted changes in that worktree; null when it isn't checked out. */
  dirty: number | null
  /**
   * Any branch against the default branch; the default branch itself against its upstream.
   * null when there is nothing to compare with.
   */
  compare: BranchCompare | null
}

export interface BranchCompare {
  against: string
  ahead: number
  behind: number
}

export interface BranchList {
  /** null when HEAD is detached. */
  current: string | null
  head: string | null
  /** `main`/`master` or whatever origin/HEAD points at; null when none of those exist. */
  defaultBranch: string | null
  /** While HEAD is detached: the branch it was detached from, to go back to. */
  previousBranch: string | null
  branches: BranchInfo[]
}

export interface CommitInfo {
  hash: string
  short: string
  parents: string[]
  author: string
  committedAt: number
  subject: string
}

export interface GraphData {
  commits: CommitInfo[]
  branches: BranchInfo[]
  head: string | null
}

export interface WorktreeRef {
  path: string
  isMain: boolean
  /** null when HEAD is detached. */
  branch: string | null
}

export interface WorktreeInfo extends WorktreeRef {
  git: GitInfo
  services: ServiceDef[]
  setup: SetupStep[]
  /** Setup steps whose `creates` path is missing. */
  missing: string[]
  /** `creates` paths that exist, i.e. what Uninstall would delete. */
  installed: string[]
  envWarnings: string[]
  docs: string[]
  runs: RunInfo[]
}

export interface ProjectSummary {
  id: string
  name: string
  relPath: string
  group: string
  path: string
  description: string | null
  stack: string[]
  githubUrl: string | null
  git: GitInfo
  worktrees: WorktreeRef[]
  serviceNames: string[]
  /** A main-checkout service has a page to open (`open` or `url` set). */
  hasPage: boolean
  needsInstall: boolean
  /** Every checkout (main or worktree) that has uncommitted changes. */
  uncommitted: UncommittedCheckout[]
  /** Everything that needs a commit, push or pull, for the Overview's Needs Attention list. */
  attention: AttentionItem[]
  /** One bucket per project, e.g. "Next.js" or "Full-stack (Python + JS)". */
  stackCategory: string
  runs: RunInfo[]
}

export type AttentionKind = 'uncommitted' | 'unpushed' | 'unpublished' | 'behind'

export interface AttentionItem {
  kind: AttentionKind
  /** null when HEAD is detached. */
  branch: string | null
  /** The checkout to open; null for a branch that isn't checked out anywhere. */
  worktree: string | null
  isMain: boolean
  /** Files for `uncommitted`, commits for the rest. */
  count: number
  /** Upstream the commits are counted against; null for `uncommitted` and `unpublished`. */
  against: string | null
}

export interface UncommittedCheckout {
  path: string
  isMain: boolean
  branch: string | null
  dirty: number
}

export interface ProjectDetail extends ProjectSummary {
  worktrees: WorktreeInfo[]
}

export type Visibility = 'public' | 'private' | 'unknown'

export interface ActivityDay {
  /** Commits on any local branch. */
  local: number
  /** Commits on one of origin's branches; `public` + `private` ≤ `pushed` (the rest are unknown). */
  pushed: number
  public: number
  private: number
}

export interface ActivitySummary {
  /** Keyed by local date, `YYYY-MM-DD`; days without commits are left out. */
  days: Record<string, ActivityDay>
  /** Years that have any commits, newest first. */
  years: number[]
  /** Local commits per project per day (same keys as `days`), for per-stack and per-project views. */
  byProject: Record<string, Record<string, number>>
  totals: { projects: number; withRemote: number; public: number; private: number }
  authorEmails: string[]
}

export type ActivityScope = 'local' | 'pushed'

export interface DayCommit {
  projectId: string
  projectName: string
  hash: string
  short: string
  subject: string
  at: number
  local: boolean
  pushed: boolean
  visibility: Visibility
}

export type ChangeStatus =
  'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'typechange' | 'conflicted'

export interface ChangedFile {
  path: string
  /** The old path of a rename. */
  origPath: string | null
  status: ChangeStatus
  additions: number
  deletions: number
  binary: boolean
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  hunks: DiffHunk[]
  binary: boolean
  /** The diff was too long to send. */
  truncated: boolean
}

export interface FetchState {
  running: boolean
  lastFetchAt: number | null
}

export interface HubMeta {
  home: string
  roots: string[]
  configPath: string
  can: { vscode: boolean; explorer: boolean; terminal: boolean }
  fetch: FetchState
}

export type OpenTarget = 'vscode' | 'explorer' | 'terminal'
