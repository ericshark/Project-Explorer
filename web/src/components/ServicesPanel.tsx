import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDiff,
  FolderGit2,
  GitBranch,
  Play,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { ProjectDetail, RunInfo, WorktreeInfo } from '../../../shared/types.ts'
import { useProjectActions } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { plural } from '../lib/branches.ts'
import { isActive, tildify } from '../lib/format.ts'
import type { GitContext } from '../lib/git-context.ts'
import { BackToBranch } from './BranchControls.tsx'
import { Button, Dialog, OpenButton, Panel, StatusPill } from './ui.tsx'

interface ServicesPanelProps {
  project: ProjectDetail
  worktree: WorktreeInfo
  git: GitContext | null
  home?: string
  /** Called after an action starts processes, so the page can show their logs. */
  onStarted: (runId?: string) => void
  onCommitAll: () => void
  onViewChanges: () => void
}

function latestRun(runs: RunInfo[], name: string): RunInfo | undefined {
  return runs
    .filter((run) => run.kind === 'service' && run.name === name)
    .sort((a, b) => b.startedAt - a.startedAt)[0]
}

export function ServicesPanel({
  project,
  worktree,
  git,
  home,
  onStarted,
  onCommitAll,
  onViewChanges,
}: ServicesPanelProps) {
  const { run, stop, restart, install, uninstall } = useProjectActions(project.id)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const active = worktree.runs.filter((r) => r.kind === 'service' && isActive(r))
  // Services with a page get an Open button up front; others only once their logs give a URL.
  const openTargets = worktree.services.flatMap((service) => {
    const last = latestRun(worktree.runs, service.name)
    const live = last && isActive(last) ? last : undefined
    return service.open || service.url || live?.url ? [{ name: service.name, live }] : []
  })
  const settingUp = worktree.runs.some((r) => r.kind === 'setup' && isActive(r))
  const needsInstall = worktree.missing.length > 0
  const { dirty } = worktree.git
  const target = worktree.branch ?? 'detached HEAD'

  const runAll = () =>
    run.mutate(
      { worktree: worktree.path },
      { onSuccess: ({ runs }) => onStarted(runs.find((r) => r.url)?.id ?? runs[0]?.id) },
    )
  const runInstall = () =>
    install.mutate(
      { worktree: worktree.path, all: !needsInstall },
      { onSuccess: () => onStarted() },
    )

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="mr-auto min-w-0 flex-1 basis-64">
          <h2 className="text-[14px] font-semibold">Services</h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-1">
              <GitBranch className="size-3.5 shrink-0 text-muted" />
              {worktree.branch ? (
                <span className="truncate font-mono font-medium">{worktree.branch}</span>
              ) : (
                <span className="truncate">
                  Detached at <span className="text-muted">“{worktree.git.subject}”</span>
                </span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-muted" title={worktree.path}>
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="truncate font-mono">
                {worktree.isMain ? 'main checkout · ' : ''}
                {tildify(worktree.path, home)}
              </span>
            </span>
          </p>
          {worktree.git.head && (
            <p className="mt-0.5 truncate pl-[18px] text-[11.5px] text-faint">
              <span className="font-mono">{worktree.git.head}</span> {worktree.git.subject}
            </p>
          )}
        </div>
        {worktree.setup.length > 0 && (
          <Button
            size="sm"
            variant={needsInstall ? 'primary' : 'ghost'}
            icon={<Download className="size-3.5" />}
            busy={install.isPending || settingUp}
            onClick={runInstall}
            title={worktree.setup.map((step) => `${step.name}: ${step.command}`).join('\n')}
          >
            {settingUp ? 'Installing…' : needsInstall ? 'Install dependencies' : 'Reinstall'}
          </Button>
        )}
        {worktree.setup.some((step) => step.creates) && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            busy={uninstall.isPending}
            disabled={worktree.installed.length === 0 || settingUp}
            onClick={() => setConfirmUninstall(true)}
            title={
              worktree.installed.length
                ? `Delete ${worktree.installed.join(', ')}`
                : 'Nothing is installed'
            }
          >
            Uninstall
          </Button>
        )}
        {worktree.services.length > 0 &&
          (active.length > 0 ? (
            <>
              <Button
                size="sm"
                icon={<RotateCw className="size-3.5" />}
                busy={restart.isPending}
                disabled={active.every((r) => r.status === 'stopping')}
                title="Stop and start the running services again with their current configuration"
                onClick={() => restart.mutate({ worktree: worktree.path })}
              >
                Restart
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Square className="size-3" />}
                busy={stop.isPending}
                onClick={() => stop.mutate({ worktree: worktree.path })}
              >
                Stop all
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="run"
              icon={<Play className="size-3" />}
              busy={run.isPending}
              disabled={settingUp}
              onClick={runAll}
              title={`Run on ${target} in ${tildify(worktree.path, home)}`}
            >
              {worktree.services.length > 1 ? 'Run all' : 'Run'}
            </Button>
          ))}
        {openTargets.map(({ name, live }) => (
          <OpenButton
            key={name}
            // Only once the port accepts connections, so Open never lands on a connection error.
            url={live?.status === 'running' ? live.url : null}
            label={openTargets.length > 1 ? `Open ${name}` : 'Open'}
            waitingTitle={live ? 'Waiting for the server…' : 'Starts with Run'}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[13px]">
        {dirty > 0 ? (
          <>
            <span className="flex items-center gap-1.5 font-medium text-bad">
              <AlertTriangle className="size-3.5" />
              {plural(dirty, 'file')} uncommitted
            </span>
            <Button size="sm" variant="primary" onClick={onCommitAll}>
              Commit all
            </Button>
            <Button
              size="sm"
              icon={<FileDiff className="size-3.5" />}
              title="Review each file's changes and pick what to commit"
              onClick={onViewChanges}
            >
              View changes
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-ok">
            <CheckCircle2 className="size-3.5" />
            All changes committed
          </span>
        )}
        {git && (
          <span className="ml-auto">
            <BackToBranch context={git} />
          </span>
        )}
      </div>

      {(needsInstall || worktree.envWarnings.length > 0) && (
        <ul className="space-y-1 border-b border-border bg-warn-soft/60 px-4 py-2.5 text-[13px] text-warn">
          {needsInstall && (
            <li className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Missing in this checkout: {worktree.missing.join(', ')}. Install before running.
            </li>
          )}
          {worktree.envWarnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {worktree.services.length === 0 ? (
        <div className="px-4 py-5 text-[13.5px] text-muted">
          <p>No dev server detected for this project.</p>
          <p className="mt-1 text-[12.5px] text-faint">
            Add a <code className="font-mono">services</code> entry for{' '}
            <code className="font-mono">"{project.relPath}"</code> in{' '}
            <code className="font-mono break-all">
              {tildify(meta?.configPath ?? 'hub.config.json', meta?.home)}
            </code>
            .
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {worktree.services.map((service) => {
            const last = latestRun(worktree.runs, service.name)
            const live = last && isActive(last) ? last : undefined
            return (
              <li
                key={service.name}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{service.name}</span>
                    <StatusPill status={last?.status ?? 'idle'} />
                    {live?.port && (
                      <span className="font-mono text-[12.5px] text-muted">:{live.port}</span>
                    )}
                  </div>
                  <p
                    className="mt-1 truncate font-mono text-[12px] text-faint"
                    title={live?.command ?? service.command}
                  >
                    {service.cwd && <span className="text-muted">{service.cwd}/ </span>}
                    {live?.command ?? service.command}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {last && (
                    <Button size="sm" variant="ghost" onClick={() => onStarted(last.id)}>
                      Logs
                    </Button>
                  )}
                  {live && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Restart ${service.name}`}
                      title="Restart"
                      icon={<RotateCw className="size-3.5" />}
                      busy={restart.isPending}
                      disabled={live.status === 'stopping'}
                      onClick={() =>
                        restart.mutate({ worktree: worktree.path, service: service.name })
                      }
                    />
                  )}
                  {live ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Stop ${service.name}`}
                      title="Stop"
                      icon={<Square className="size-3.5" />}
                      disabled={live.status === 'stopping'}
                      onClick={() =>
                        stop.mutate({ worktree: worktree.path, service: service.name })
                      }
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Run ${service.name}`}
                      title="Run"
                      icon={<Play className="size-3.5" />}
                      disabled={settingUp}
                      onClick={() =>
                        run.mutate(
                          { worktree: worktree.path, service: service.name },
                          { onSuccess: ({ runs }) => onStarted(runs[0]?.id) },
                        )
                      }
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={confirmUninstall}
        onClose={() => setConfirmUninstall(false)}
        size="sm"
        title="Uninstall dependencies"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmUninstall(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => {
                uninstall.mutate({ worktree: worktree.path })
                setConfirmUninstall(false)
              }}
            >
              Uninstall
            </Button>
          </>
        }
      >
        <div className="space-y-2 px-4 py-3 text-[13px]">
          <p>These folders will be deleted from this checkout:</p>
          <ul className="space-y-0.5 font-mono text-[12.5px]">
            {worktree.installed.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {active.length > 0 && (
            <p className="text-warn">Its running services will be stopped first.</p>
          )}
          <p className="text-muted">Install brings them back.</p>
        </div>
      </Dialog>
    </Panel>
  )
}
