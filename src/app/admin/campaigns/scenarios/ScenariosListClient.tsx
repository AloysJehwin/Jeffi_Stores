'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { ap } from '@/lib/admin-path'
import { RequireWrite } from '@/contexts/AdminScopesContext'

interface ScenarioCampaign {
  scenario_kind: string
  kind: string
  name: string
  enabled: boolean
  delay_hours: number
  discount_percent: number
  last_run_at: string | null
}

interface Scenario {
  kind: string
  name: string
  description: string
  trigger: string
  type: 'builtin' | 'custom'
  enabled: boolean
  default_parameters: Record<string, number | boolean | string>
  param_schema: Record<string, { type: string; label: string; description?: string; min?: number; max?: number }>
  stats: {
    campaigns_count: number
    total_sent: number
    total_opened: number
    total_clicked: number
    total_converted: number
    last_run_at: string | null
  }
  campaigns: ScenarioCampaign[]
}

function rate(num: number, den: number) {
  if (den === 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

export default function ScenariosListClient() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/campaigns/scenarios', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setScenarios(data.scenarios || [])
      }
    } finally {
      setLoading(false)
    }
  }

  async function toggle(s: Scenario) {
    if (s.type !== 'custom') return
    setBusy(s.kind)
    try {
      const res = await fetch(`/api/admin/campaigns/scenarios/${s.kind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: !s.enabled }),
      })
      if (res.ok) {
        showToast(s.enabled ? 'Scenario paused' : 'Scenario activated', 'success')
        await load()
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed', 'error')
      }
    } finally {
      setBusy(null)
    }
  }

  async function remove(s: Scenario) {
    if (s.type !== 'custom') return
    if (s.stats.campaigns_count > 0) {
      showToast('Delete the campaigns using this scenario first', 'error')
      return
    }
    const ok = await confirm({
      title: 'Delete scenario?',
      message: `"${s.name}" will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setBusy(s.kind)
    try {
      const res = await fetch(`/api/admin/campaigns/scenarios/${s.kind}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        showToast('Scenario deleted', 'success')
        await load()
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed', 'error')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Link
            href={ap('/admin/campaigns')}
            className="px-4 py-2 text-sm font-semibold text-foreground-muted hover:text-foreground border-b-2 border-transparent transition-colors"
          >
            Campaigns
          </Link>
          <Link
            href={ap('/admin/campaigns/scenarios')}
            className="px-4 py-2 text-sm font-semibold text-accent-600 dark:text-accent-400 border-b-2 border-accent-500"
          >
            Scenarios
          </Link>
        </div>
        <RequireWrite scope="campaigns:write">
          <Link
            href={ap('/admin/campaigns/scenarios/new')}
            className="mb-1 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95"
          >
            + New scenario
          </Link>
        </RequireWrite>
      </div>

      {loading ? (
        <p className="text-sm text-foreground-muted pt-4">Loading scenarios…</p>
      ) : (
        <div className="space-y-3 pt-2">
          {scenarios.map(s => (
            <div key={s.kind} className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-semibold text-foreground text-lg">{s.name}</h3>
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {s.kind}
                    </span>
                    {s.type === 'custom' ? (
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                        Custom
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Built-in
                      </span>
                    )}
                    {s.type === 'custom' && (
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        s.enabled
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}>
                        {s.enabled ? 'Active' : 'Paused'}
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-secondary-100 text-secondary-700 dark:bg-secondary-900/40 dark:text-secondary-300">
                      {s.stats.campaigns_count} campaign{s.stats.campaigns_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-xs text-foreground-secondary mt-1">{s.description}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {s.type === 'custom' && (
                    <RequireWrite scope="campaigns:write">
                    <button
                      type="button"
                      onClick={() => toggle(s)}
                      disabled={busy === s.kind}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                        s.enabled
                          ? 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200'
                          : 'bg-green-500 hover:bg-green-600 text-white'
                      }`}
                    >
                      {s.enabled ? 'Pause' : 'Activate'}
                    </button>
                    </RequireWrite>
                  )}
                  <RequireWrite scope="campaigns:write">
                    <Link
                      href={ap(`/admin/campaigns/new?scenario=${s.kind}`)}
                      className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95"
                    >
                      + New campaign
                    </Link>
                  </RequireWrite>
                  <Link
                    href={ap(`/admin/campaigns/scenarios/${s.kind}`)}
                    className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    Configure
                  </Link>
                  {s.type === 'custom' && s.stats.campaigns_count === 0 && (
                    <RequireWrite scope="campaigns:write">
                    <button
                      type="button"
                      onClick={() => remove(s)}
                      disabled={busy === s.kind}
                      className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50"
                    >
                      Delete
                    </button>
                    </RequireWrite>
                  )}
                </div>
              </div>

              <div className="mt-3 p-3 bg-surface-secondary rounded-lg border-l-2 border-accent-500">
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-1">When this fires</p>
                <p className="text-xs text-foreground-secondary leading-relaxed">{s.trigger}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Sent</p>
                  <p className="text-lg font-bold text-foreground tabular-nums">{s.stats.total_sent.toLocaleString('en-IN')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Opened</p>
                  <p className="text-lg font-bold text-foreground tabular-nums">{s.stats.total_opened.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-foreground-muted">{rate(s.stats.total_opened, s.stats.total_sent)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Clicked</p>
                  <p className="text-lg font-bold text-foreground tabular-nums">{s.stats.total_clicked.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-foreground-muted">{rate(s.stats.total_clicked, s.stats.total_sent)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Converted</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">{s.stats.total_converted.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-foreground-muted">{rate(s.stats.total_converted, s.stats.total_sent)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Last run</p>
                  <p className="text-sm font-medium text-foreground">
                    {s.stats.last_run_at
                      ? new Date(s.stats.last_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'Never'}
                  </p>
                </div>
              </div>

              {s.campaigns.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border-default">
                  <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">Campaigns using this scenario</p>
                  <div className="flex flex-wrap gap-2">
                    {s.campaigns.map(c => (
                      <Link
                        key={c.kind}
                        href={ap(`/admin/campaigns/${c.kind}`)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                          c.enabled
                            ? 'bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40 dark:text-green-300'
                            : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${c.enabled ? 'bg-green-500' : 'bg-zinc-400'}`} />
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <details className="mt-3">
                <summary className="text-[10px] uppercase tracking-wide text-foreground-muted cursor-pointer hover:text-foreground transition-colors">
                  Default parameters ({Object.keys(s.default_parameters).length})
                </summary>
                <div className="mt-2 p-3 bg-surface-secondary rounded-lg font-mono text-xs text-foreground-secondary overflow-auto">
                  {Object.entries(s.default_parameters).map(([k, v]) => {
                    const def = s.param_schema[k]
                    return (
                      <div key={k} className="py-0.5">
                        <span className="text-accent-600 dark:text-accent-400">{k}</span>
                        <span className="text-foreground-muted"> = </span>
                        <span>{String(v)}</span>
                        {def?.label && <span className="text-foreground-muted"> &nbsp;// {def.label}</span>}
                      </div>
                    )
                  })}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
