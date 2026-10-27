import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useEffect, useRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api.ts'
import { cn } from '../lib/format.ts'
import { resolveRelative } from '../lib/paths.ts'

interface DocsViewerProps {
  projectId: string
  worktree: string
  docs: string[]
  selected: string | null
  onSelect: (path: string) => void
}

const EXTERNAL = /^[a-z][a-z\d+.-]*:/i

export function DocsViewer({ projectId, worktree, docs, selected, onSelect }: DocsViewerProps) {
  const current = selected && docs.includes(selected) ? selected : (docs[0] ?? null)
  const articleRef = useRef<HTMLDivElement>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['doc', projectId, worktree, current],
    queryFn: () => api.doc(projectId, worktree, current!),
    enabled: Boolean(current),
  })

  useEffect(() => {
    articleRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  if (docs.length === 0) {
    return (
      <p className="py-10 text-center text-[13.5px] text-muted">
        No markdown docs in this checkout.
      </p>
    )
  }

  const components: Components = {
    a: ({ href = '', children, ...props }) => {
      if (EXTERNAL.test(href) || href.startsWith('#')) {
        const external = EXTERNAL.test(href)
        return (
          <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} {...props}>
            {children}
          </a>
        )
      }
      const [path, hash] = href.split('#')
      const target = current ? resolveRelative(current, decodeURI(path)) : null
      if (target && /\.(md|mdx|markdown)$/i.test(target) && docs.includes(target)) {
        return (
          <a
            href={`#${hash ?? ''}`}
            onClick={(event) => {
              event.preventDefault()
              onSelect(target)
            }}
            {...props}
          >
            {children}
          </a>
        )
      }
      // Source files and folders aren't viewable here, so the link is shown as plain text.
      return <span className="text-link">{children}</span>
    },
    img: ({ src, alt, ...props }) => {
      const raw = typeof src === 'string' ? src : ''
      const target = !raw || EXTERNAL.test(raw) || !current ? null : resolveRelative(current, raw)
      const resolved = target ? api.fileUrl(projectId, worktree, target) : raw
      return <img src={resolved} alt={alt ?? ''} loading="lazy" {...props} />
    },
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <nav aria-label="Documents" className="md:w-52 md:shrink-0">
        <select
          className="h-9 w-full rounded-lg border border-border bg-surface px-2 font-mono text-[13px] md:hidden"
          value={current ?? ''}
          onChange={(event) => onSelect(event.target.value)}
          aria-label="Document"
        >
          {docs.map((doc) => (
            <option key={doc} value={doc}>
              {doc}
            </option>
          ))}
        </select>
        <ul className="hidden space-y-0.5 md:block">
          {docs.map((doc) => (
            <li key={doc}>
              <button
                type="button"
                onClick={() => onSelect(doc)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-[12.5px]',
                  doc === current
                    ? 'bg-surface-2 text-text'
                    : 'text-muted hover:bg-surface-2/60 hover:text-text',
                )}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate" title={doc}>
                  {doc}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div ref={articleRef} className="min-w-0 flex-1 scroll-mt-4">
        {isLoading && <p className="text-[13.5px] text-muted">Loading…</p>}
        {error && <p className="text-[13.5px] text-bad">{error.message}</p>}
        {data && (
          <article className="markdown max-w-3xl">
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { detect: false }]]}
              components={components}
            >
              {data.content}
            </Markdown>
          </article>
        )}
      </div>
    </div>
  )
}
