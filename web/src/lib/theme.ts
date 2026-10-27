import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'project-explorer-theme'
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'system' || stored === 'dark' ? stored : 'light'
  } catch {
    return 'light'
  }
}

function apply(preference: ThemePreference) {
  const dark = preference === 'system' ? darkQuery().matches : preference === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function useTheme() {
  const [preference, setPreference] = useState(readPreference)

  useEffect(() => {
    apply(preference)
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Storage can be unavailable (private mode); the choice just won't persist.
    }
    if (preference !== 'system') return
    const query = darkQuery()
    const onChange = () => apply('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  const cycle = () =>
    setPreference((current) =>
      current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light',
    )
  return { preference, cycle, setPreference }
}
