import { Monitor, Moon, Sun } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '../lib/format.ts'
import { updateSettings, useSettings, type Settings } from '../lib/settings.ts'
import type { ThemePreference } from '../lib/theme.ts'
import { Dialog } from './ui.tsx'

const THEMES: {
  value: ThemePreference
  label: string
  icon: ComponentType<{ className?: string }>
}[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const SECTIONS: { key: keyof Settings; label: string; hint: string }[] = [
  {
    key: 'expandActivity',
    label: 'Expand Activity',
    hint: 'Commit heatmaps on a project page',
  },
  {
    key: 'expandBranches',
    label: 'Expand Branches',
    hint: 'Local and remote branches on a project page',
  },
]

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 cursor-pointer rounded-full border transition',
        checked ? 'border-transparent bg-ok' : 'border-border-strong bg-surface-2',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  )
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  theme: ThemePreference
  onSetTheme: (theme: ThemePreference) => void
}

export function SettingsDialog({ open, onClose, theme, onSetTheme }: SettingsDialogProps) {
  const settings = useSettings()
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Settings">
      <div className="space-y-5 px-4 py-4">
        <section>
          <h3 className="text-[12px] font-medium tracking-wide text-faint uppercase">
            Project page
          </h3>
          <p className="mt-1 text-[12.5px] text-muted">
            Which sections start expanded when you open a project. You can still open or close each
            one on the page.
          </p>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {SECTIONS.map(({ key, label, hint }) => (
              <li key={key} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{label}</p>
                  <p className="text-[12px] text-faint">{hint}</p>
                </div>
                <Switch
                  checked={settings[key]}
                  label={label}
                  onChange={(checked) => updateSettings({ [key]: checked })}
                />
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-[12px] font-medium tracking-wide text-faint uppercase">Theme</h3>
          <div role="radiogroup" aria-label="Theme" className="mt-2 grid grid-cols-3 gap-1.5">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => onSetTheme(value)}
                className={cn(
                  'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium',
                  theme === value
                    ? 'border-link/60 bg-link/5 text-text'
                    : 'border-border text-muted hover:border-border-strong hover:text-text',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  )
}
