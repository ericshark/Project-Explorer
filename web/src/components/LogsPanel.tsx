import { AnsiUp } from 'ansi_up'
import { Eraser, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogLine, RunInfo } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { cn, isActive, timeAgo } from '../lib/format.ts'
import { toastError } from '../lib/toast.ts'
import { StatusDot } from './ui.tsx'

const MAX_LINES = 5000

interface RenderedLine {
  key: number
  stream: LogLine['stream']
  html: string
}

function useRunLogs(runId: string | undefined) {
  // Keyed by run so switching runs shows an empty view until the new backlog arrives.
  const [state, setState] = useState<{ runId?: string; lines: RenderedLine[] }>({ lines: [] })

  useEffect(() => {
    if (!runId) return
    // One converter per stream: ANSI state (e.g. an unclosed colour) carries across lines.
    const ansi = new AnsiUp()
    ansi.use_classes = true
    let key = 0
    const render = (batch: LogLine[]): RenderedLine[] =>
      batch.map((line) => ({ key: key++, stream: line.stream, html: ansi.ansi_to_html(line.text) }))
    const append = (batch: LogLine[], reset = false) =>
      setState((previous) => {
        const kept = reset || previous.runId !== runId ? [] : previous.lines
        const next = [...kept, ...render(batch)]
        return { runId, lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next }
      })

    const source = new EventSource(api.logsUrl(runId))
    // A reconnect re-sends the backlog, so it replaces rather than appends.
    source.addEventListener('backlog', (event) => {
      append(JSON.parse((event as MessageEvent<string>).data) as LogLine[], true)
    })
    source.addEventListener('lines', (event) => {
      append(JSON.parse((event as MessageEvent<string>).data) as LogLine[])
    })
    return () => source.close()
  }, [runId])

  return {
    lines: state.runId === runId ? state.lines : [],
    clear: () => setState({ runId, lines: [] }),
  }
}

interface LogsPanelProps {
  runs: RunInfo[]
  selectedId: string | null
  onSelect: (runId: string) => void
}

export function LogsPanel({ runs, selectedId, onSelect }: LogsPanelProps) {
  const ordered = useMemo(
    () =>
      [...runs].sort(
        (a, b) =>
          Number(b.kind === 'service') - Number(a.kind === 'service') || a.startedAt - b.startedAt,
      ),
    [runs],
  )
  // Without an explicit pick, follow whatever started most recently (e.g. the next setup step).
  const newest = [...runs].sort((a, b) => b.startedAt - a.startedAt)[0]
  const selected = runs.find((run) => run.id === selectedId) ?? newest
  const { lines, clear } = useRunLogs(selected?.id)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines])

  if (runs.length === 0) {
    return (
      <p className="py-10 text-center text-[13.5px] text-muted">
        Nothing has run in this checkout yet. Logs show up here once you run or install.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-log">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-2 py-1.5">
        {ordered.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelect(run.id)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 font-mono text-[12px]',
              run.id === selected?.id
                ? 'bg-white/10 text-log-text'
                : 'text-log-muted hover:bg-white/5 hover:text-log-text',
            )}
          >
            <StatusDot status={run.status} className="size-1.5" />
            {run.kind === 'setup' && <span className="text-log-muted">setup:</span>}
            {run.name}
          </button>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {selected && (
            <span className="hidden font-mono text-[11px] text-log-muted sm:inline">
              {selected.status === 'exited' || selected.status === 'failed'
                ? `${selected.exitCode === null ? 'stopped' : `exit ${selected.exitCode}`} · ${timeAgo(selected.endedAt)}`
                : `started ${timeAgo(selected.startedAt)}`}
            </span>
          )}
          <button
            type="button"
            onClick={clear}
            title="Clear"
            aria-label="Clear log view"
            className="grid size-7 cursor-pointer place-items-center rounded-md text-log-muted hover:bg-white/10 hover:text-log-text"
          >
            <Eraser className="size-3.5" />
          </button>
          {selected && isActive(selected) && (
            <button
              type="button"
              title="Stop"
              aria-label={`Stop ${selected.name}`}
              disabled={selected.status === 'stopping'}
              onClick={() => api.stopRun(selected.id).catch(toastError)}
              className="grid size-7 cursor-pointer place-items-center rounded-md text-log-muted hover:bg-white/10 hover:text-log-text disabled:opacity-50"
            >
              <Square className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="h-[min(60vh,560px)] overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.6] text-log-text"
      >
        {lines.map((line) => (
          <div
            key={line.key}
            className={cn(
              'log-line min-h-[1.6em] whitespace-pre-wrap break-all',
              line.stream === 'sys' && 'text-log-muted italic',
            )}
            // ansi_up escapes HTML in the text; it only adds its own <span class="ansi-…">.
            dangerouslySetInnerHTML={{ __html: line.html }}
          />
        ))}
      </div>
    </div>
  )
}
