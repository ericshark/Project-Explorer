import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { ArrowUpRight, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { cn, type Health } from '../lib/format.ts'

type Variant = 'primary' | 'secondary' | 'ghost' | 'run' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:opacity-90 border-transparent',
  secondary: 'bg-surface text-text border-border hover:border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-muted border-transparent hover:text-text hover:bg-surface-2',
  run: 'bg-ok text-ok-text border-transparent hover:brightness-110',
  danger: 'bg-surface text-bad border-border hover:border-bad/50 hover:bg-bad-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  busy?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 text-[12.5px]' : 'h-9 text-[13.5px]',
        children ? (size === 'sm' ? 'px-2.5' : 'px-3.5') : size === 'sm' ? 'w-7' : 'w-9',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}

interface OpenButtonProps {
  /** Set once the service accepts connections; until then the button is greyed out. */
  url: string | null
  label: string
  /** Shown while there's no URL yet, e.g. "Starts with Run". */
  waitingTitle: string
}

/** Always in place next to Run, so it doesn't jump in; turns green when the server is ready. */
export function OpenButton({ url, label, waitingTitle }: OpenButtonProps) {
  const className =
    'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition'
  if (!url) {
    return (
      <button
        type="button"
        disabled
        title={waitingTitle}
        className={cn(
          className,
          'cursor-not-allowed border-border bg-surface-2 text-faint opacity-60',
        )}
      >
        {label}
        <ArrowUpRight className="size-3.5" />
      </button>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className={cn(className, 'border-transparent bg-ok text-ok-text hover:brightness-110')}
    >
      {label}
      <ArrowUpRight className="size-3.5" />
    </a>
  )
}

const DOT: Record<Health, string> = {
  idle: 'bg-border-strong',
  starting: 'bg-warn animate-pulse-dot',
  stopping: 'bg-faint animate-pulse-dot',
  running: 'bg-ok',
  exited: 'bg-border-strong',
  failed: 'bg-bad',
}

export function StatusDot({ status, className }: { status: Health; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[status], className)}
    />
  )
}

const LABEL: Record<Health, { text: string; className: string }> = {
  idle: { text: 'Stopped', className: 'text-muted bg-surface-2' },
  starting: { text: 'Starting', className: 'text-warn bg-warn-soft' },
  stopping: { text: 'Stopping', className: 'text-muted bg-surface-2' },
  running: { text: 'Running', className: 'text-ok bg-ok-soft' },
  exited: { text: 'Stopped', className: 'text-muted bg-surface-2' },
  failed: { text: 'Failed', className: 'text-bad bg-bad-soft' },
}

export function StatusPill({ status }: { status: Health }) {
  const { text, className } = LABEL[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium',
        className,
      )}
    >
      <StatusDot status={status} className="size-1.5" />
      {text}
    </span>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-px text-[11.5px] text-muted">
      {children}
    </span>
  )
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-border bg-surface', className)}>
      {children}
    </section>
  )
}

interface CollapsiblePanelProps {
  title: string
  /** Shown beside the title, e.g. a count, so a collapsed panel still says what's inside. */
  badge?: ReactNode
  /** Extra header content, such as controls; only shown while expanded. */
  actions?: ReactNode
  /** Starting state; the panel manages it from there. */
  defaultExpanded: boolean
  children: ReactNode
}

/** A Panel whose body hides behind its header. */
export function CollapsiblePanel({
  title,
  badge,
  actions,
  defaultExpanded,
  children,
}: CollapsiblePanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const bodyId = useId()
  return (
    <Panel>
      <div className="flex items-center gap-2 pr-4">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-left"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {badge}
        </button>
        {expanded && actions}
      </div>
      <div id={bodyId} hidden={!expanded}>
        {expanded && children}
      </div>
    </Panel>
  )
}

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Sits under the title, outside the scrolling body (e.g. tabs). */
  toolbar?: ReactNode
  footer?: ReactNode
  /** `xl` nearly fills the window, for content that benefits from room, like the commit graph. */
  size?: 'sm' | 'lg' | 'xl'
  children: ReactNode
}

/** A modal on the native <dialog>, which brings focus trapping, Esc and the backdrop for free. */
export function Dialog({
  open,
  onClose,
  title,
  toolbar,
  footer,
  size = 'lg',
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className={cn(
        'm-auto w-[calc(100vw-32px)] flex-col rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/40 open:flex',
        size === 'xl' ? 'max-h-[92vh]' : 'max-h-[min(88vh,900px)]',
        { sm: 'max-w-md', lg: 'max-w-4xl', xl: 'max-w-[min(1400px,96vw)]' }[size],
      )}
    >
      {open && (
        <>
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            <h2 className="mr-auto min-w-0 truncate text-[15px] font-semibold">{title}</h2>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Close"
              icon={<X className="size-4" />}
              onClick={onClose}
            />
          </header>
          {toolbar && <div className="border-b border-border px-4 py-2.5">{toolbar}</div>}
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  )
}

/** lucide dropped brand icons, so the GitHub mark is inlined. */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
