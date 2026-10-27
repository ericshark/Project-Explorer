import { useQuery } from '@tanstack/react-query'
import { GitBranch, LayoutGrid, Monitor, Moon, Settings, Sun } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { ProjectSummary } from '../../../shared/types.ts'
import { api, PROJECT_POLL_MS } from '../lib/api.ts'
import { plural } from '../lib/branches.ts'
import { cn, isActive, overallStatus } from '../lib/format.ts'
import { groupProjects } from '../lib/projects.ts'
import type { ThemePreference } from '../lib/theme.ts'
import { SettingsDialog } from './SettingsDialog.tsx'
import { StatusDot } from './ui.tsx'

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon }

/** "Uncommitted changes: main (3 files), feature (1 file)". */
function uncommittedTitle(project: ProjectSummary): string {
  const parts = project.uncommitted.map(
    (wt) => `${wt.branch ?? 'detached HEAD'} (${plural(wt.dirty, 'file')})`,
  )
  return `Uncommitted changes: ${parts.join(', ')}`
}

interface SidebarProps {
  onNavigate?: () => void
  theme: ThemePreference
  onCycleTheme: () => void
  onSetTheme: (theme: ThemePreference) => void
}

export function Sidebar({ onNavigate, theme, onCycleTheme, onSetTheme }: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects,
    refetchInterval: PROJECT_POLL_MS,
  })
  const running = projects.flatMap((p) => p.runs).filter((r) => r.kind === 'service' && isActive(r))
  const ThemeIcon = THEME_ICON[theme]

  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <NavLink to="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight">Project Explorer</span>
        </NavLink>
        <button
          type="button"
          onClick={onCycleTheme}
          title={`Theme: ${theme}`}
          aria-label={`Theme: ${theme}. Click to change.`}
          className="grid size-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
        >
          <ThemeIcon className="size-4" />
        </button>
      </div>

      <div className="px-2">
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          className={({ isActive: current }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]',
              current ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text',
            )
          }
        >
          <LayoutGrid className="size-4" />
          Overview
          {running.length > 0 && (
            <span className="ml-auto rounded-full bg-ok-soft px-1.5 text-[11px] font-medium text-ok">
              {running.length} running
            </span>
          )}
        </NavLink>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-6">
        {isLoading && <p className="px-2.5 text-[13px] text-faint">Scanning…</p>}
        {groupProjects(projects).map(([group, items]) => (
          <div key={group} className="mt-3 first:mt-0">
            <h3 className="px-2.5 pb-1 font-mono text-[11px] tracking-wide text-faint uppercase">
              {group || 'GitHub'}
            </h3>
            <ul>
              {items.map((project) => {
                const status = overallStatus(project.runs)
                return (
                  <li key={project.id}>
                    <NavLink
                      to={`/p/${project.id}`}
                      onClick={onNavigate}
                      className={({ isActive: current }) =>
                        cn(
                          'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]',
                          current
                            ? 'bg-surface-2 font-medium text-text'
                            : 'text-muted hover:bg-surface-2/60 hover:text-text',
                        )
                      }
                    >
                      <StatusDot status={status} className={cn(status === 'idle' && 'opacity-0')} />
                      <span className="truncate">{project.name}</span>
                      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-faint">
                        {project.worktrees.length > 1 && (
                          <span className="flex items-center gap-0.5" title="Worktrees">
                            <GitBranch className="size-3" />
                            {project.worktrees.length}
                          </span>
                        )}
                        {project.uncommitted.length > 0 && (
                          <span title={uncommittedTitle(project)} className="text-warn">
                            ●
                          </span>
                        )}
                      </span>
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-muted hover:bg-surface-2/60 hover:text-text"
        >
          <Settings className="size-4" />
          Settings
        </button>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onSetTheme={onSetTheme}
      />
    </nav>
  )
}
