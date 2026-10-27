import { useSyncExternalStore } from 'react'

export interface Settings {
  /** Whether a project page opens with its Activity section expanded. */
  expandActivity: boolean
  /** Whether a project page opens with its Branches section expanded. */
  expandBranches: boolean
}

const STORAGE_KEY = 'project-explorer-settings'
export const DEFAULT_SETTINGS: Settings = { expandActivity: false, expandBranches: false }

export function parseSettings(raw: string | null): Settings {
  try {
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    return {
      expandActivity:
        typeof stored.expandActivity === 'boolean'
          ? stored.expandActivity
          : DEFAULT_SETTINGS.expandActivity,
      expandBranches:
        typeof stored.expandBranches === 'boolean'
          ? stored.expandBranches
          : DEFAULT_SETTINGS.expandBranches,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function read(): Settings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

let current = read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab changing the setting should apply here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    current = read()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function updateSettings(changes: Partial<Settings>): void {
  current = { ...current, ...changes }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Storage can be unavailable (private mode); the choice just won't persist.
  }
  for (const listener of listeners) listener()
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => current)
}
