import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { api } from '../lib/api.ts'
import { hostingHeadings } from '../lib/hosting-markdown.ts'
import { Button } from './ui.tsx'

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
      {data && <HostingMarkdown key={id} content={data.content} />}
    </>
  )
}

function HostingIndex() {
  const { data, isLoading, error } = useQuery({ queryKey: ['hosting'], queryFn: api.hosting })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const groups = [
    { title: 'Your guides', guides: data?.guides.filter((guide) => guide.private) },
    { title: 'Shared guides', guides: data?.guides.filter((guide) => !guide.private) },
  ]
  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Hosting</h1>
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
      {groups.map(({ title, guides }) =>
        guides?.length ? (
          <section key={title} className="mb-7">
            <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {guides.map((guide) => (
                <li key={guide.id} className="px-4 py-3">
                  <Link
                    to={`/hosting/${guide.id}`}
                    className="flex items-center justify-between gap-3 text-[14px] font-medium hover:text-link"
                  >
                    {guide.title}
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
                  </Link>
                  {guide.projects.length ? (
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                      {guide.projects.map((project) => (
                        <li key={project.id}>
                          {projects.some((candidate) => candidate.id === project.id) ? (
                            <Link to={`/p/${project.id}`} className="hover:text-link">
                              {project.name}
                            </Link>
                          ) : (
                            project.name
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[13px] text-muted">{guide.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  )
}
export function HostingPage() {
  const { guideId } = useParams()
  const { hash } = useLocation()
  if (guideId === 'vercel-next') return <Navigate to={`/hosting/vercel-static${hash}`} replace />
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      {guideId ? <GuideDetail key={guideId} id={guideId} /> : <HostingIndex />}
    </div>
  )
}
