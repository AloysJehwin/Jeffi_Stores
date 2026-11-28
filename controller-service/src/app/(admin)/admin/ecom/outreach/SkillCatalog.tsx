'use client'

import { useState } from 'react'
import { api, Badge, btnGhost } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { API, CHANNEL_LABEL, GROUP_LABEL } from './shared'

type Tool = { name: string; description: string; channels: string[]; effect: string; mandatory: boolean; group?: string }
type Catalog = { tools: Tool[]; limits: Record<string, number>; placeholders: string[] }

/** What a skill author can name: the tools, the hard limits and the {{placeholders}}. Loaded on first open. */
export default function SkillCatalog() {
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !cat) {
      const { ok, data } = await api<Catalog>(`${API}/catalog`)
      if (!ok) return setError(data.error || 'Could not load the catalog')
      setError(null)
      setCat(data)
    }
  }

  return (
    <Card
      title="Tool catalog"
      hint="The tools an agent can list, the hard limits it can only lower, and the placeholders it can use."
      action={
        <button type="button" className={btnGhost} aria-expanded={open} onClick={toggle}>
          {open ? 'Hide' : 'Show'}
        </button>
      }
    >
      {!open && <p className="text-sm text-foreground-muted">Open to see every tool by name.</p>}
      {open && error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {open && !cat && !error && <div className="h-24 rounded-lg bg-surface-secondary animate-pulse" />}
      {open && cat && (
        <div className="space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                  <th className="py-1.5 pr-3">Tool</th>
                  <th className="py-1.5 pr-3">Group</th>
                  <th className="py-1.5 pr-3">Channels</th>
                  <th className="py-1.5 pr-3">Effect</th>
                  <th className="py-1.5">What it does</th>
                </tr>
              </thead>
              <tbody>
                {cat.tools.map(t => (
                  <tr key={t.name} className="border-t border-border-default/60 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="font-mono text-xs">{t.name}</span> {t.mandatory && <Badge tone="blue">Always on</Badge>}
                    </td>
                    <td className="py-1.5 pr-3 text-xs">{GROUP_LABEL[t.group ?? ''] ?? t.group ?? '-'}</td>
                    <td className="py-1.5 pr-3 text-xs">{t.channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ')}</td>
                    <td className="py-1.5 pr-3 text-xs">{t.effect}</td>
                    <td className="py-1.5 text-xs text-foreground-muted">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Hard limits</h3>
            <table className="text-sm">
              <tbody>
                {Object.entries(cat.limits).map(([k, v]) => (
                  <tr key={k} className="border-t border-border-default/60">
                    <td className="py-1 pr-6 font-mono text-xs">{k}</td>
                    <td className="py-1 tabular-nums">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!cat.placeholders?.length && (
            <div className="flex flex-wrap gap-1.5">
              {cat.placeholders.map(p => (
                <span key={p} className="font-mono text-xs">
                  <Badge>{`{{${p}}}`}</Badge>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
