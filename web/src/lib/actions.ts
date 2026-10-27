import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OpenTarget } from '../../../shared/types.ts'
import { api, type CheckoutTarget } from './api.ts'
import { toastError } from './toast.ts'

/** Run/stop/restart/install/open and git actions (including fetch/pull/push) for one project, with errors surfaced as toasts. */
export function useProjectActions(projectId: string) {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['git', projectId] })
    // Commits, pulls and pushes change the heatmaps; the server only recounts repos whose refs moved.
    void queryClient.invalidateQueries({ queryKey: ['activity'] })
  }

  const run = useMutation({
    mutationFn: ({ worktree, service }: { worktree: string; service?: string }) =>
      api.run(projectId, worktree, service),
    onError: toastError,
    onSettled: refresh,
  })
  const stop = useMutation({
    mutationFn: ({ worktree, service }: { worktree: string; service?: string }) =>
      api.stop(projectId, worktree, service),
    onError: toastError,
    onSettled: refresh,
  })
  const restart = useMutation({
    mutationFn: ({ worktree, service }: { worktree: string; service?: string }) =>
      api.restart(projectId, worktree, service),
    onError: toastError,
    onSettled: refresh,
  })
  const install = useMutation({
    mutationFn: ({ worktree, all }: { worktree: string; all?: boolean }) =>
      api.install(projectId, worktree, all),
    onError: toastError,
    onSettled: refresh,
  })
  const uninstall = useMutation({
    mutationFn: ({ worktree }: { worktree: string }) => api.uninstall(projectId, worktree),
    onError: toastError,
    onSettled: refresh,
  })
  const checkout = useMutation({
    mutationFn: ({ worktree, target }: { worktree: string; target: CheckoutTarget }) =>
      api.checkout(projectId, worktree, target),
    onError: toastError,
    onSettled: refresh,
  })
  const commit = useMutation({
    mutationFn: ({
      worktree,
      message,
      paths,
    }: {
      worktree: string
      message: string
      /** Commit only these files; omit to commit everything. */
      paths?: string[]
    }) => api.commit(projectId, worktree, message, paths),
    onError: toastError,
    onSettled: refresh,
  })
  const fetch = useMutation({
    mutationFn: () => api.fetch(projectId),
    onError: toastError,
    onSettled: refresh,
  })
  const pull = useMutation({
    mutationFn: ({ worktree }: { worktree: string }) => api.pull(projectId, worktree),
    onError: toastError,
    onSettled: refresh,
  })
  const push = useMutation({
    mutationFn: ({ worktree }: { worktree: string }) => api.push(projectId, worktree),
    onError: toastError,
    onSettled: refresh,
  })
  const open = useMutation({
    mutationFn: ({ worktree, target }: { worktree: string; target: OpenTarget }) =>
      api.open(projectId, worktree, target),
    onError: toastError,
  })

  return { run, stop, restart, install, uninstall, checkout, commit, fetch, pull, push, open }
}
