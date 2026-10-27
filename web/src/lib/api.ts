import type {
  ActivityScope,
  ActivitySummary,
  BranchList,
  ChangedFile,
  DayCommit,
  CommitInfo,
  FileDiff,
  GraphData,
  HubMeta,
  OpenTarget,
  ProjectDetail,
  ProjectSummary,
  RunInfo,
} from '../../../shared/types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body as T
}

function post<T>(path: string, body: object): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Run status arrives over SSE; this poll only picks up git changes made outside Project Explorer. */
export const PROJECT_POLL_MS = 15_000

export type CheckoutTarget = { branch: string } | { commit: string }

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`

export const api = {
  meta: () => request<HubMeta>('/api/meta'),
  activity: (projectId?: string) =>
    request<ActivitySummary>(
      `/api/activity?${new URLSearchParams(projectId ? { project: projectId } : {})}`,
    ),
  activityDay: (date: string, scope: ActivityScope, projectId?: string) =>
    request<DayCommit[]>(
      `/api/activity/day?${new URLSearchParams({ date, scope, ...(projectId ? { project: projectId } : {}) })}`,
    ),
  projects: () => request<ProjectSummary[]>('/api/projects'),
  project: (id: string) => request<ProjectDetail>(project(id)),
  doc: (id: string, worktree: string, path: string) =>
    request<{ path: string; content: string }>(
      `${project(id)}/doc?${new URLSearchParams({ worktree, path })}`,
    ),
  fileUrl: (id: string, worktree: string, path: string) =>
    `${project(id)}/file?${new URLSearchParams({ worktree, path })}`,
  run: (id: string, worktree: string, service?: string) =>
    post<{ runs: RunInfo[] }>(`${project(id)}/run`, { worktree, service }),
  stop: (id: string, worktree: string, service?: string) =>
    post<{ stopped: string[] }>(`${project(id)}/stop`, { worktree, service }),
  restart: (id: string, worktree: string, service?: string) =>
    post<{ runs: RunInfo[] }>(`${project(id)}/restart`, { worktree, service }),
  install: (id: string, worktree: string, all = false) =>
    post<{ steps: string[] }>(`${project(id)}/install`, { worktree, all }),
  uninstall: (id: string, worktree: string) =>
    post<{ removed: string[] }>(`${project(id)}/uninstall`, { worktree }),
  branches: (id: string, worktree: string) =>
    request<BranchList>(`${project(id)}/branches?${new URLSearchParams({ worktree })}`),
  commits: (id: string, worktree: string, ref: string, skip = 0) =>
    request<CommitInfo[]>(
      `${project(id)}/commits?${new URLSearchParams({ worktree, ref, skip: String(skip) })}`,
    ),
  graph: (id: string, worktree: string) =>
    request<GraphData>(`${project(id)}/graph?${new URLSearchParams({ worktree })}`),
  checkout: (id: string, worktree: string, target: CheckoutTarget) =>
    post<{ ok: true }>(`${project(id)}/checkout`, { worktree, ...target }),
  commit: (id: string, worktree: string, message: string, paths?: string[]) =>
    post<{ head: string }>(`${project(id)}/commit`, { worktree, message, paths }),
  changes: (id: string, worktree: string) =>
    request<ChangedFile[]>(`${project(id)}/changes?${new URLSearchParams({ worktree })}`),
  diff: (id: string, worktree: string, path: string, full = false) =>
    request<FileDiff>(
      `${project(id)}/diff?${new URLSearchParams({ worktree, path, ...(full ? { full: '1' } : {}) })}`,
    ),
  fetchAll: () => post<{ fetchedAt: number | null; failed: string[] }>('/api/fetch', {}),
  fetch: (id: string) => post<{ ok: true }>(`${project(id)}/fetch`, {}),
  pull: (id: string, worktree: string) => post<{ ok: true }>(`${project(id)}/pull`, { worktree }),
  push: (id: string, worktree: string) => post<{ ok: true }>(`${project(id)}/push`, { worktree }),
  open: (id: string, worktree: string, target: OpenTarget) =>
    post<{ ok: true }>(`${project(id)}/open`, { worktree, target }),
  stopRun: (runId: string) => post<{ ok: true }>(`/api/runs/${runId}/stop`, {}),
  logsUrl: (runId: string) => `/api/runs/${runId}/logs`,
}
