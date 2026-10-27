import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { ServiceDef, SetupStep } from '../shared/types.ts'
import { loadPrivateEnv } from './env.ts'

loadPrivateEnv()

export interface ProjectOverride {
  name?: string
  description?: string
  hidden?: boolean
  /** Replaces the bucket this project is counted in by the commits-by-stack chart. */
  stackCategory?: string
  services?: ServiceDef[]
  setup?: SetupStep[]
}

export interface ActivityConfig {
  /** Extra emails that count as yours, e.g. an old address or a GitHub noreply address. */
  authorEmails?: string[]
}

export interface HubConfig {
  roots: string[]
  /** Repo or folder paths relative to a root that should not be listed. */
  ignore: string[]
  /** Keyed by repo path relative to its root, e.g. "misc/auth-api". */
  projects: Record<string, ProjectOverride>
  activity: ActivityConfig
}

export const CONFIG_PATH =
  process.env.HUB_CONFIG ?? fileURLToPath(new URL('../hub.config.json', import.meta.url))

const DEFAULT_CONFIG: HubConfig = {
  roots: [expandHome('~/GitHub')],
  ignore: [],
  projects: {},
  activity: {},
}

let cached: { mtimeMs: number; config: HubConfig } | null = null

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path
}

/** Re-reads hub.config.json whenever its mtime changes, so edits apply without a restart. */
export function getConfig(): HubConfig {
  let mtimeMs: number
  try {
    mtimeMs = statSync(CONFIG_PATH).mtimeMs
  } catch {
    return DEFAULT_CONFIG
  }
  if (cached?.mtimeMs === mtimeMs) return cached.config

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<HubConfig>
    const config: HubConfig = {
      roots: (raw.roots ?? DEFAULT_CONFIG.roots).map(expandHome),
      ignore: raw.ignore ?? [],
      projects: raw.projects ?? {},
      activity: raw.activity ?? {},
    }
    cached = { mtimeMs, config }
    return config
  } catch (error) {
    console.error(`[project-explorer] could not parse ${CONFIG_PATH}: ${(error as Error).message}`)
    return cached?.config ?? DEFAULT_CONFIG
  }
}
