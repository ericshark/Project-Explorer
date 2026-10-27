import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { FetchState, RunInfo } from '../../../shared/types.ts'

/** Keeps project queries fresh by listening to Project Explorer's run-status stream. */
export function useHubEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource('/api/events')
    const dirty = new Set<string>()
    let timer: number | undefined

    // Status changes arrive in bursts (start, ready, URL found), so refetches are coalesced.
    const flush = () => {
      timer = undefined
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      for (const id of dirty) void queryClient.invalidateQueries({ queryKey: ['project', id] })
      dirty.clear()
    }

    source.addEventListener('run', (event) => {
      const run = JSON.parse((event as MessageEvent<string>).data) as RunInfo
      dirty.add(run.projectId)
      timer ??= window.setTimeout(flush, 120)
    })
    // A finished fetch can change ahead/behind and pushed commits anywhere; the start of one
    // only needs the meta (for the spinner).
    source.addEventListener('fetch', (event) => {
      const state = JSON.parse((event as MessageEvent<string>).data) as FetchState
      void queryClient.invalidateQueries(state.running ? { queryKey: ['meta'] } : undefined)
    })
    // After a server restart every run is gone, so everything needs a refetch.
    source.addEventListener('hello', () => {
      void queryClient.invalidateQueries()
    })

    return () => {
      source.close()
      window.clearTimeout(timer)
    }
  }, [queryClient])
}
