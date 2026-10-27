import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangedFile,
  ChangeStatus,
  ProjectDetail,
  WorktreeInfo,
} from '../../../shared/types.ts'
import { useProjectActions } from '../lib/actions.ts'
import { api } from '../lib/api.ts'
import { plural } from '../lib/branches.ts'
import { toSideBySide, type DiffSide } from '../lib/diff.ts'
import { cn } from '../lib/format.ts'
import { toast } from '../lib/toast.ts'
import { Button, Dialog } from './ui.tsx'

const STATUS: Record<ChangeStatus, { letter: string; label: string; className: string }> = {
  modified: { letter: 'M', label: 'Modified', className: 'bg-warn-soft text-warn' },
  added: { letter: 'A', label: 'Added', className: 'bg-ok-soft text-ok' },
  untracked: { letter: 'U', label: 'Untracked (new file)', className: 'bg-ok-soft text-ok' },
  deleted: { letter: 'D', label: 'Deleted', className: 'bg-bad-soft text-bad' },
  renamed: { letter: 'R', label: 'Renamed', className: 'bg-link/10 text-link' },
  typechange: { letter: 'T', label: 'Type changed', className: 'bg-warn-soft text-warn' },
  conflicted: { letter: '!', label: 'Merge conflict', className: 'bg-bad-soft text-bad' },
}

function StatusBadge({ status }: { status: ChangeStatus }) {
  const { letter, label, className } = STATUS[status]
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold',
        className,
      )}
    >
      {letter}
    </span>
  )
}

function splitPath(path: string): [string, string] {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? ['', path] : [path.slice(0, slash + 1), path.slice(slash + 1)]
}

function LineCounts({ file }: { file: ChangedFile }) {
  if (file.binary) return <span className="text-[11px] text-faint">binary</span>
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-[11px] tabular-nums">
      {file.additions > 0 && <span className="text-ok">+{file.additions}</span>}
      {file.deletions > 0 && <span className="text-bad">−{file.deletions}</span>}
    </span>
  )
}

function FileRow({
  file,
  checked,
  active,
  onToggle,
  onOpen,
}: {
  file: ChangedFile
  checked: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const [dir, name] = splitPath(file.path)
  return (
    <li className={cn('flex items-center gap-2 pl-3', active && 'bg-surface-2')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Include ${file.path}`}
        className="size-4 shrink-0 cursor-pointer accent-link"
      />
      <button
        type="button"
        onClick={onOpen}
        aria-current={active}
        title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-3 text-left hover:bg-surface-2/60"
      >
        <StatusBadge status={file.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
          <span className="text-faint">{dir}</span>
          {name}
        </span>
        <LineCounts file={file} />
      </button>
    </li>
  )
}

function Side({ side, tone }: { side: DiffSide | null; tone: 'del' | 'add' }) {
  const filled = side && side.kind !== 'context'
  const background = !side
    ? 'bg-surface-2/50'
    : filled
      ? tone === 'del'
        ? 'bg-bad-soft'
        : 'bg-ok-soft'
      : ''
  return (
    <>
      <span
        className={cn(
          'select-none px-2 text-right font-mono text-[11.5px] text-faint tabular-nums',
          background,
        )}
      >
        {side?.no}
      </span>
      <span
        className={cn(
          'min-w-0 px-2 font-mono text-[12.5px] leading-5 break-all whitespace-pre-wrap',
          background,
        )}
      >
        {side?.text}
      </span>
    </>
  )
}

function DiffView({
  projectId,
  worktree,
  file,
}: {
  projectId: string
  worktree: string
  file: ChangedFile
}) {
  const [full, setFull] = useState(false)
  // Edits to the file while the dialog is open change these counts and so refetch the diff.
  const version = `${file.status}:${file.additions}:${file.deletions}`
  const diff = useQuery({
    queryKey: ['git', projectId, 'diff', worktree, file.path, full, version],
    queryFn: () => api.diff(projectId, worktree, file.path, full),
  })
  const rows = useMemo(() => toSideBySide(diff.data?.hunks ?? []), [diff.data])
  const [dir, name] = splitPath(file.path)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2">
        <StatusBadge status={file.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={file.path}>
          <span className="text-faint">{dir}</span>
          <span className="font-medium">{name}</span>
          {file.origPath && <span className="text-faint"> ← {file.origPath}</span>}
        </span>
        <LineCounts file={file} />
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setFull((current) => !current)}>
            {full ? 'Show changes only' : 'Show whole file'}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {diff.isLoading ? (
          <p className="px-4 py-4 text-[13px] text-muted">Loading diff…</p>
        ) : diff.error ? (
          <p className="px-4 py-4 text-[13px] text-bad">{diff.error.message}</p>
        ) : diff.data?.binary ? (
          <p className="px-4 py-4 text-[13px] text-muted">Binary file, nothing to compare.</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">
            {file.status === 'untracked' || file.status === 'added'
              ? 'Empty file.'
              : 'No content changes (for example, only the file mode changed).'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] border-b border-border bg-surface-2/60 text-[11.5px] font-medium text-muted">
              <span className="col-span-2 px-2 py-1">
                {file.status === 'untracked' || file.status === 'added'
                  ? 'Before'
                  : 'Before (HEAD)'}
              </span>
              <span className="col-span-2 border-l border-border px-2 py-1">
                After (working tree)
              </span>
            </div>
            <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] [&>*:nth-child(4n+3)]:border-l [&>*:nth-child(4n+3)]:border-border">
              {rows.map((row, index) =>
                row.type === 'gap' ? (
                  <span
                    key={index}
                    className="col-span-4 border-y border-border bg-surface-2/60 py-0.5 text-center font-mono text-[11px] text-faint"
                  >
                    ⋯
                  </span>
                ) : (
                  <Row key={index} left={row.left} right={row.right} />
                ),
              )}
            </div>
            {diff.data?.truncated && (
              <p className="border-t border-border px-4 py-2 text-[12.5px] text-warn">
                This diff is very long, so only the first part is shown.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ left, right }: { left: DiffSide | null; right: DiffSide | null }) {
  return (
    <>
      <Side side={left} tone="del" />
      <Side side={right} tone="add" />
    </>
  )
}

interface ChangesDialogProps {
  open: boolean
  onClose: () => void
  project: ProjectDetail
  worktree: WorktreeInfo
}

export function ChangesDialog({ open, onClose, project, worktree }: ChangesDialogProps) {
  const { commit } = useProjectActions(project.id)
  const [message, setMessage] = useState('')
  // Everything starts selected; only the files the user opts out of are remembered, so files that
  // appear while the dialog is open come in selected too.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [openedPath, setOpenedPath] = useState<string | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const branch = worktree.git.branch ?? `detached @ ${worktree.git.head ?? '?'}`

  const changes = useQuery({
    queryKey: ['git', project.id, 'changes', worktree.path],
    queryFn: () => api.changes(project.id, worktree.path),
    enabled: open,
    refetchOnMount: 'always',
    refetchInterval: open ? 5000 : false,
  })
  const files = useMemo(() => changes.data ?? [], [changes.data])
  const selected = files.filter((file) => !excluded.has(file.path))
  const active = files.find((file) => file.path === openedPath) ?? files[0]

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.length > 0 && selected.length < files.length
    }
  }, [selected.length, files.length])

  const close = () => {
    setMessage('')
    setExcluded(new Set())
    setOpenedPath(null)
    onClose()
  }

  const toggle = (path: string) =>
    setExcluded((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const setAll = (checked: boolean) =>
    setExcluded(checked ? new Set() : new Set(files.map((file) => file.path)))

  const submit = () => {
    if (!message.trim() || selected.length === 0 || commit.isPending) return
    const count = selected.length
    const everything = count === files.length
    commit.mutate(
      { worktree: worktree.path, message, paths: selected.map((file) => file.path) },
      {
        onSuccess: ({ head }) => {
          toast(`Committed ${head} on ${branch} (${plural(count, 'file')})`)
          setMessage('')
          setExcluded(new Set())
          if (everything) close()
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title={
        <>
          Changes · {project.name}{' '}
          <span className="font-mono text-[13px] font-normal text-muted">{branch}</span>
        </>
      }
      footer={
        <div className="flex w-full flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 basis-96">
            <label htmlFor="changes-message" className="sr-only">
              Commit message
            </label>
            <textarea
              id="changes-message"
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder="Commit message (Ctrl+Enter to commit)"
              className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-border-strong focus:ring-2 focus:ring-(--ring)"
            />
          </div>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={commit.isPending}
            disabled={!message.trim() || selected.length === 0}
            title={
              selected.length === 0
                ? 'Select at least one file'
                : !message.trim()
                  ? 'Write a commit message'
                  : undefined
            }
            onClick={submit}
          >
            Commit selected ({selected.length})
          </Button>
        </div>
      }
    >
      {changes.isLoading ? (
        <p className="px-4 py-4 text-[13px] text-muted">Reading changes…</p>
      ) : changes.error ? (
        <p className="px-4 py-4 text-[13px] text-bad">{changes.error.message}</p>
      ) : files.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">No uncommitted changes.</p>
      ) : (
        <div className="flex flex-col md:h-[64vh] md:flex-row">
          <div className="flex max-h-72 flex-col border-b border-border md:max-h-none md:w-80 md:shrink-0 md:border-r md:border-b-0 lg:w-96">
            <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-[12.5px] font-medium">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={selected.length === files.length}
                onChange={(event) => setAll(event.target.checked)}
                className="size-4 cursor-pointer accent-link"
              />
              Select all
              <span className="ml-auto font-normal text-muted">
                {selected.length} of {files.length} selected
              </span>
            </label>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  checked={!excluded.has(file.path)}
                  active={file.path === active?.path}
                  onToggle={() => toggle(file.path)}
                  onOpen={() => setOpenedPath(file.path)}
                />
              ))}
            </ul>
          </div>
          <div className="flex min-h-80 min-w-0 flex-1 flex-col">
            {active && (
              <DiffView
                key={active.path}
                projectId={project.id}
                worktree={worktree.path}
                file={active}
              />
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
