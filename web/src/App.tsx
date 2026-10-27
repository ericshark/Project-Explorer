import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Overview } from './components/Overview.tsx'
import { ProjectPage } from './components/ProjectPage.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { useHubEvents } from './lib/events.ts'
import { useTheme } from './lib/theme.ts'
import { cn } from './lib/format.ts'
import { dismissToast, useToasts } from './lib/toast.ts'

function Toasts() {
  const toasts = useToasts()
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-[13.5px] shadow-lg',
            toast.tone === 'error'
              ? 'border-bad/30 bg-surface text-bad'
              : 'border-border bg-surface text-text',
          )}
        >
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
            className="cursor-pointer text-muted hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function App() {
  useHubEvents()
  const { preference, cycle, setPreference } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface md:block">
        <Sidebar theme={preference} onCycleTheme={cycle} onSetTheme={setPreference} />
      </aside>

      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open project list"
          className="grid size-8 cursor-pointer place-items-center rounded-md hover:bg-surface-2"
        >
          <Menu className="size-5" />
        </button>
        <img src="/favicon.svg" alt="" className="size-5" />
        <span className="text-[15px] font-semibold tracking-tight">Project Explorer</span>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close project list"
            className="absolute inset-0 cursor-default bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] border-r border-border bg-surface shadow-xl">
            <Sidebar
              theme={preference}
              onCycleTheme={cycle}
              onSetTheme={setPreference}
              onNavigate={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      )}

      <main className="md:pl-64">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/p/:id" element={<ProjectPage />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </main>
      <Toasts />
    </div>
  )
}
