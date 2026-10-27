import { EventEmitter } from 'node:events'
import type { Repo } from './discovery.ts'
import { fetchRepo } from './git.ts'
import type { FetchState } from '../shared/types.ts'

const CONCURRENCY = 4

/** Fetches every repo, a few at a time; one repo failing (offline, no access) never stops the rest. */
export class Fetcher extends EventEmitter<{ change: [FetchState] }> {
  private state: FetchState = { running: false, lastFetchAt: null }
  private inFlight: Promise<{ failed: string[] }> | null = null

  get current(): FetchState {
    return { ...this.state }
  }

  /** Joins the fetch already in progress instead of starting a second one. */
  fetchAll(repos: Repo[]): Promise<{ failed: string[] }> {
    this.inFlight ??= this.run(repos).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(repos: Repo[]): Promise<{ failed: string[] }> {
    this.update({ ...this.state, running: true })
    const failed: string[] = []
    const queue = [...repos]
    const worker = async () => {
      for (let repo = queue.shift(); repo; repo = queue.shift()) {
        try {
          await fetchRepo(repo.path)
        } catch (error) {
          failed.push(repo.relPath)
          console.error(`[project-explorer] fetch ${repo.relPath}: ${(error as Error).message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    this.update({ running: false, lastFetchAt: Date.now() })
    return { failed }
  }

  private update(state: FetchState): void {
    this.state = state
    this.emit('change', { ...state })
  }
}
