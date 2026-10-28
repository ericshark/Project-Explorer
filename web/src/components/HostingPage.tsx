import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { api } from '../lib/api.ts'
import { hostingHeadings } from '../lib/hosting-markdown.ts'
import { Button, Chip } from './ui.tsx'

const EXTERNAL = /^https?:\/\//i
function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [state, setState] = useState('Copy')
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="my-4 min-w-0 rounded-lg border border-border bg-surface">
      <div className="flex justify-end border-b border-border px-2 py-1">
        <Button
          size="sm"
          icon={state === 'Copied' ? <Check className="size-3" /> : <Copy className="size-3" />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(ref.current?.textContent ?? '')
              setState('Copied')
            } catch {
              setState('Copy failed')
            }
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setState('Copy'), 1800)
          }}
        >
          {state}
        </Button>
      </div>
      <pre {...props} ref={ref} style={{ margin: 0, border: 0 }}>
        {children}
      </pre>
    </div>
  )
}

export function HostingMarkdown({ content }: { content: string }) {
  const components: Components = {
    pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
    a: ({ href = '', children }) =>
      EXTERNAL.test(href) ? (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : href.startsWith('/hosting') || href.startsWith('#') ? (
        <Link to={href}>{children}</Link>
      ) : (
        <span>{children}</span>
      ),
    // Guide images are unnecessary and must not initiate remote tracking requests.
    img: ({ alt }) => <span>{alt}</span>,
  }
  const location = useLocation()
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [location.hash, content])
  return (
    <article className="markdown min-w-0 max-w-3xl [overflow-wrap:anywhere] [&_table]:block [&_table]:overflow-x-auto [&_h1]:scroll-mt-20 [&_h2]:scroll-mt-20 [&_h3]:scroll-mt-20">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, hostingHeadings]}
        components={components}
      >
        {content}
      </Markdown>
    </article>
  )
}

function GuideDetail({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['hosting-guide', id],
    queryFn: () => api.hostingGuide(id),
    staleTime: 0,
  })
  return (
    <>
      <Link
        to="/hosting"
        className="mb-6 inline-flex items-center gap-2 text-[13px] text-muted hover:text-text"
      >
        <ArrowLeft className="size-4" />
        All hosting guides
      </Link>
      {isLoading && (
        <p role="status" className="text-muted">
          Loading guide…
        </p>
      )}
      {error && (
        <p role="alert" className="text-bad">
          Could not load guide: {error.message}
        </p>
      )}
      {data && (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {data.providers.map((p) => (
              <Chip key={p}>{p}</Chip>
            ))}
            <Chip>{data.private ? 'Personal guide' : 'Shared recipe'}</Chip>
          </div>
          <nav
            aria-label="Guide sections"
            className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-y border-border py-3 text-[12px] text-muted"
          >
            {['Summary', 'Run locally', 'Deploy publicly', 'Domain', 'Cost']
              .filter((title) => data.content.includes(`## ${title}\n`))
              .map((title) => (
                <Link
                  key={title}
                  className="hover:text-link"
                  to={`#${title.toLowerCase().replaceAll(' ', '-')}`}
                >
                  {title}
                </Link>
              ))}
          </nav>
          <HostingMarkdown key={id} content={data.content} />
        </>
      )}
    </>
  )
}

function HostingIndex() {
  const { data, isLoading, error } = useQuery({ queryKey: ['hosting'], queryFn: api.hosting })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const groups = new Map<string, NonNullable<typeof data>['guides']>()
  for (const guide of data?.guides ?? [])
    groups.set(guide.category, [...(groups.get(guide.category) ?? []), guide])
  return (
    <>
      <header className="mb-8">
        <p className="mb-2 flex items-center gap-2 text-[12px] font-medium text-muted">
          <BookOpen className="size-4" />
          Reference library
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Hosting</h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">
          From running locally to going live. Start with the simplest setup, then follow the steps
          your project needs.
        </p>
      </header>
      {isLoading && (
        <p role="status" className="text-muted">
          Loading hosting guides…
        </p>
      )}
      {error && (
        <p role="alert" className="text-bad">
          Could not load hosting guides: {error.message}
        </p>
      )}
      {data?.warnings.map((w) => (
        <p key={w} role="alert" className="mb-4 rounded-lg border border-border p-3 text-warn">
          {w}
        </p>
      ))}
      {data && !data.guides.length && (
        <p className="text-muted">No hosting guides are available yet.</p>
      )}
      {[...groups].map(([category, guides]) => (
        <section key={category} className="mb-8" aria-label={category}>
          <h2 className="mb-3 text-[15px] font-semibold">{category}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {guides.map((guide) => (
              <div key={guide.id} className="rounded-xl border border-border bg-surface p-4">
                <Link
                  to={`/hosting/${guide.id}`}
                  className="group flex items-start justify-between gap-3 text-[15px] font-medium hover:text-link"
                >
                  {guide.title}
                  <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted" />
                </Link>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{guide.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {guide.providers.map((p) => (
                    <Chip key={p}>{p}</Chip>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-muted">{guide.cost}</p>
                {guide.projects.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-[12px] text-muted">
                    {guide.projects.map((p) => (
                      <li key={p.id}>
                        {projects.some((project) => project.id === p.id) ? (
                          <Link to={`/p/${p.id}`} className="hover:text-link">
                            {p.name}
                          </Link>
                        ) : (
                          <span>{p.name}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {data?.guides.some((g) => g.private) && (
        <p className="text-[12px] text-muted">
          Personal guides stay on this machine and are not included in Git. Back up the local guide
          folder separately.
        </p>
      )}
    </>
  )
}
export function HostingPage() {
  const { guideId } = useParams()
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      {guideId ? <GuideDetail key={guideId} id={guideId} /> : <HostingIndex />}
    </div>
  )
}
