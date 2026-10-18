'use client'

import { useEffect, useState } from 'react'
import { ap } from '@/lib/shared/admin-path'

interface Preset {
  kind: 'image' | 'video'
  feature?: string
  scenario: string
  prompt: string
  display_order?: number
  source?: 'default' | 'tenant'
}

interface Props {
  kind: 'image' | 'video'
  feature?: string
  onPick: (prompt: string) => void
}

// Fetches merged preset prompts for the caller tenant and renders a horizontal
// rail-scrolling chip row. Clicking a chip fills the parent's textarea; no local
// state is persisted. Fails silently so the modal never breaks.
export default function PresetChipRow({ kind, feature, onPick }: Props) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const q = new URLSearchParams({ kind })
    if (feature) q.set('feature', feature)
    const ctl = new AbortController()
    fetch(ap(`/api/admin/ai/preset-prompts?${q.toString()}`), { signal: ctl.signal, credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { presets: Preset[] }) => setPresets(j.presets ?? []))
      .catch(() => {})
    return () => ctl.abort()
  }, [kind, feature])

  if (presets.length === 0) return null

  return (
    <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 pb-1">
      {presets.map(p => {
        const label = scenarioLabel(p.scenario)
        const isActive = active === p.scenario
        return (
          <button
            key={`${p.feature ?? '_'}:${p.scenario}`}
            type="button"
            onClick={() => {
              setActive(p.scenario)
              onPick(p.prompt)
            }}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'border-accent-500/60 bg-accent-500/10 text-accent-700 dark:text-accent-300'
                : 'border-border-default bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary'
            }`}
            title={p.prompt}
          >
            {label}
          </button>
        )
      })}
      {active && (
        <button
          type="button"
          onClick={() => {
            setActive(null)
            onPick('')
          }}
          className="shrink-0 whitespace-nowrap rounded-full border border-border-default bg-surface-elevated px-3 py-1 text-xs text-foreground-muted hover:bg-surface-secondary"
          title="Clear the prompt"
        >
          Reset
        </button>
      )}
    </div>
  )
}

// snake_case scenario -> Title Case label.
function scenarioLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
