import { useQuery } from '@tanstack/react-query'
import { Check, Code2, Copy, FolderOpen, GitBranch, SquareTerminal } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectDetail, WorktreeInfo } from '../../../shared/types.ts'
import { useProjectActions } from '../lib/actions.ts'
import { api, PROJECT_POLL_MS } from '../lib/api.ts'
import { cn, isActive, overallStatus, tildify } from '../lib/format.ts'
import { useGitContext } from '../lib/git-context.ts'
import { toastError } from '../lib/toast.ts'
import { ActivitySection } from './ActivitySection.tsx'
import { BranchesPanel } from './BranchesPanel.tsx'
import { GitDialogs } from './GitDialogs.tsx'
import { GitPanel } from './GitPanel.tsx'
import { LogsPanel } from './LogsPanel.tsx'
import { ServicesPanel } from './ServicesPanel.tsx'
import { Button, Chip, GitHubMark, Panel, StatusDot } from './ui.tsx'

type Tab = 'docs' | 'logs'

// Markdown + syntax highlighting is most of the bundle, so it loads on first use.
const DocsViewer = lazy(() =>
  import('./DocsViewer.tsx').then((module) => ({ default: module.DocsViewer })),
)

function CopyCd({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      title={`cd ${path}`}
      onClick={() =>
        navigator.clipboard.writeText(`cd ${JSON.stringify(path)}`).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }, toastError)
      }
    >
      {copied ? 'Copied' : 'Copy cd'}
    </Button>
  )
}

function WorktreePicker({
  project,
  selected,
  onSelect,
  home,
}: {
  project: ProjectDetail
  selected: WorktreeInfo
  onSelect: (path: string) => void
  home?: string
}) {
  return (
    <Panel>
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-[14px] font-semibold">Checkouts</h2>
        <span className="text-[12.5px] text-faint">{project.worktrees.length}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2 border-t border-border p-3">
        {project.worktrees.map((wt) => {
          const running = wt.runs.filter((r) => r.kind === 'service' && isActive(r)).length
          const current = wt.path === selected.path
          return (
            <button
              key={wt.path}
              type="button"
              onClick={() => onSelect(wt.path)}
              aria-pressed={current}
              className={cn(
                'relative min-w-0 cursor-pointer rounded-lg border px-3 py-2.5 text-left transition',
                current
                  ? 'border-link/60 bg-link/5'
                  : 'border-border bg-surface hover:border-border-strong hover:bg-surface-2/50',
              )}
            >
              {current && (
                <span className="absolute top-2.5 right-2.5 grid size-4 place-items-center rounded-full bg-link text-bg">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
              <span className="flex items-center gap-1.5 pr-6 font-mono text-[12.5px] font-medium">
                <GitBranch
                  className={cn('size-3.5 shrink-0', current ? 'text-link' : 'text-muted')}
                />
                <span className="truncate">{wt.branch ?? 'detached HEAD'}</span>
              </span>
              {!wt.branch && wt.git.subject && (
                <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                  at “{wt.git.subject}”
                </span>
              )}
              <span
                className="mt-1 block truncate font-mono text-[11px] text-faint"
                title={wt.path}
              >
                {wt.isMain ? 'main checkout' : tildify(wt.path, home)}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-2.5 text-[11.5px] text-muted">
                {running > 0 && (
                  <span className="flex items-center gap-1 text-ok">
                    <StatusDot status="running" className="size-1.5" />
                    {running} running
                  </span>
                )}
                {wt.git.dirty > 0 && <span className="text-warn">{wt.git.dirty} changed</span>}
                {wt.missing.length > 0 && <span className="text-faint">needs install</span>}
                {running === 0 && wt.git.dirty === 0 && wt.missing.length === 0 && (
                  <span className="text-faint">clean</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

/** Services, checkouts, git and branches for the selected checkout, sharing one git context. */
function CheckoutSections({
  project,
  worktree,
  home,
  onSelectWorktree,
  onStarted,
}: {
  project: ProjectDetail
  worktree: WorktreeInfo
  home?: string
  onSelectWorktree: (path: string) => void
  onStarted: (runId?: string) => void
}) {
  const { context, dialog, openDialog, closeDialog } = useGitContext(
    project,
    worktree,
    home,
    onSelectWorktree,
  )
  return (
    <>
      <ServicesPanel
        project={project}
        worktree={worktree}
        git={context}
        home={home}
        onStarted={onStarted}
        onCommitAll={() => openDialog('commit')}
        onViewChanges={() => openDialog('changes')}
      />
      <WorktreePicker
        project={project}
        selected={worktree}
        home={home}
        onSelect={onSelectWorktree}
      />
      <GitPanel projectId={project.id} worktree={worktree} context={context} onOpen={openDialog} />
      <BranchesPanel context={context} />
      <ActivitySection projectId={project.id} collapsible />
      {context && <GitDialogs context={context} dialog={dialog} onClose={closeDialog} />}
    </>
  )
}

export function ProjectPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const {
    data: project,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.project(id),
    refetchInterval: PROJECT_POLL_MS,
  })
  const { open } = useProjectActions(id)

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: true },
    )

  if (isLoading) return <p className="p-8 text-muted">Loading…</p>
  if (error || !project) {
    return (
      <div className="p-8">
        <p className="text-bad">{error?.message ?? 'Project not found'}</p>
        <Link to="/" className="mt-2 inline-block text-link hover:underline">
          Back to overview
        </Link>
      </div>
    )
  }

  const worktree =
    project.worktrees.find((wt) => wt.path === params.get('wt')) ??
    project.worktrees.find((wt) => wt.isMain) ??
    project.worktrees[0]
  const hasRuns = worktree.runs.length > 0
  const tab: Tab = (params.get('tab') as Tab | null) ?? (hasRuns ? 'logs' : 'docs')
  const status = overallStatus(worktree.runs)

  const showLogs = (runId?: string) => update({ tab: 'logs', run: runId ?? null })

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4">
        <div>
          {project.group && <p className="font-mono text-[12px] text-faint">{project.group}/</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{project.name}</h1>
            {status !== 'idle' && status !== 'exited' && (
              <StatusDot status={status} className="size-2.5" />
            )}
            {project.githubUrl && (
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text"
              >
                <GitHubMark className="size-4" />
                {project.githubUrl.replace(/^https:\/\/(www\.)?github\.com\//, '')}
              </a>
            )}
          </div>
          {project.description && (
            <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-muted">
              {project.description}
            </p>
          )}
          {project.stack.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {project.stack.map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {meta?.can.vscode && (
            <Button
              size="sm"
              icon={<Code2 className="size-3.5" />}
              onClick={() => open.mutate({ worktree: worktree.path, target: 'vscode' })}
            >
              VS Code
            </Button>
          )}
          {meta?.can.explorer && (
            <Button
              size="sm"
              icon={<FolderOpen className="size-3.5" />}
              onClick={() => open.mutate({ worktree: worktree.path, target: 'explorer' })}
            >
              Explorer
            </Button>
          )}
          {meta?.can.terminal && (
            <Button
              size="sm"
              icon={<SquareTerminal className="size-3.5" />}
              onClick={() => open.mutate({ worktree: worktree.path, target: 'terminal' })}
            >
              Terminal
            </Button>
          )}
          <CopyCd path={worktree.path} />
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-5">
        <CheckoutSections
          project={project}
          worktree={worktree}
          home={meta?.home}
          onSelectWorktree={(path) => update({ wt: path, run: null, doc: null })}
          onStarted={showLogs}
        />

        <section>
          <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
            {(['docs', 'logs'] as const).map((name) => (
              <button
                key={name}
                role="tab"
                type="button"
                aria-selected={tab === name}
                onClick={() => update({ tab: name })}
                className={cn(
                  '-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13.5px] font-medium capitalize',
                  tab === name
                    ? 'border-text text-text'
                    : 'border-transparent text-muted hover:text-text',
                )}
              >
                {name}
                {name === 'docs' && (
                  <span className="ml-1.5 text-[11.5px] text-faint">{worktree.docs.length}</span>
                )}
                {name === 'logs' && hasRuns && (
                  <span className="ml-1.5 text-[11.5px] text-faint">{worktree.runs.length}</span>
                )}
              </button>
            ))}
          </div>
          {tab === 'docs' ? (
            <Suspense fallback={<p className="text-[13.5px] text-muted">Loading…</p>}>
              <DocsViewer
                projectId={project.id}
                worktree={worktree.path}
                docs={worktree.docs}
                selected={params.get('doc')}
                onSelect={(doc) => update({ doc })}
              />
            </Suspense>
          ) : (
            <LogsPanel
              runs={worktree.runs}
              selectedId={params.get('run')}
              onSelect={(run) => update({ run })}
            />
          )}
        </section>
      </div>
    </div>
  )
}
