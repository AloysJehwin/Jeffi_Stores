'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import { ap } from '@/lib/shared/admin-path'
import AdminSelect from '@/components/admin/AdminSelect'
import { RequireWrite } from '@/contexts/AdminScopesContext'

interface ParamDef {
  type: 'integer' | 'number' | 'boolean'
  label: string
  description?: string
  min?: number
  max?: number
}

interface Scenario {
  kind: string
  name: string
  description: string
  trigger: string
  default_parameters: Record<string, number | boolean | string>
  param_schema: Record<string, ParamDef>
}

interface CampaignDetail {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  parameters: Record<string, number | boolean | string> | null
  last_run_at: string | null
  total_sent: number
  total_opened: number
  total_clicked: number
  total_converted: number
}

function rate(num: number, den: number) {
  if (den === 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

export default function ScenarioDetailClient({ kind }: { kind: string }) {
  const { showToast } = useToast()
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [overrides, setOverrides] = useState<Record<string, Record<string, number | boolean | string>>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [kind])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/campaigns/scenarios/${kind}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setScenario(data.scenario)
        setCampaigns(data.campaigns || [])
        const init: Record<string, Record<string, number | boolean | string>> = {}
        for (const c of data.campaigns || []) {
          init[c.kind] = { ...(c.parameters || {}) }
        }
        setOverrides(init)
      } else {
        showToast('Scenario not found', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  function setOverrideValue(campaignKind: string, paramKey: string, value: number | boolean | string | null) {
    setOverrides(o => {
      const current = { ...(o[campaignKind] || {}) }
      if (value === null || value === '') {
        delete current[paramKey]
      } else {
        current[paramKey] = value
      }
      return { ...o, [campaignKind]: current }
    })
  }

  async function saveOverrides(campaignKind: string) {
    setSavingKey(campaignKind)
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignKind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ parameters: overrides[campaignKind] || {} }),
      })
      if (res.ok) {
        showToast('Parameters saved', 'success')
        await load()
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to save', 'error')
      }
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) return <p className="text-sm text-foreground-muted">Loading scenario…</p>
  if (!scenario) return <p className="text-sm text-foreground-muted">Scenario not found.</p>

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={ap('/admin/campaigns/scenarios')}
          className="text-foreground-muted hover:text-foreground transition-colors"
        >
          Scenarios
        </Link>
        <span className="text-foreground-muted">/</span>
        <span className="text-foreground font-medium">{scenario.name}</span>
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{scenario.name}</h1>
              <span className="px-2 py-0.5 text-xs font-mono rounded bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {scenario.kind}
              </span>
            </div>
            <p className="text-sm text-foreground-secondary mt-1">{scenario.description}</p>
          </div>
          <RequireWrite scope="campaigns:write">
            <Link
              href={ap(`/admin/campaigns/new?scenario=${scenario.kind}`)}
              className="hidden md:inline-flex items-center px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 shrink-0"
            >
              + New campaign
            </Link>
          </RequireWrite>
        </div>

        <div className="mt-4 p-3 bg-surface-secondary rounded-lg border-l-2 border-accent-500">
          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-1">When this fires</p>
          <p className="text-sm text-foreground-secondary leading-relaxed">{scenario.trigger}</p>
        </div>

        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">Scenario default parameters</p>
          <div className="p-3 bg-surface-secondary rounded-lg font-mono text-xs space-y-0.5">
            {Object.entries(scenario.default_parameters).map(([k, v]) => {
              const def = scenario.param_schema[k]
              return (
                <div key={k}>
                  <span className="text-accent-600 dark:text-accent-400">{k}</span>
                  <span className="text-foreground-muted"> = </span>
                  <span className="text-foreground">{String(v)}</span>
                  {def?.label && <span className="text-foreground-muted"> &nbsp;// {def.label}</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Campaigns using this scenario ({campaigns.length})
        </h2>
        {campaigns.length === 0 ? (
          <div className="bg-surface-elevated rounded-xl border border-border-default p-8 text-center">
            <p className="text-sm text-foreground-muted mb-4">No campaigns are using this scenario yet.</p>
            <RequireWrite scope="campaigns:write">
              <Link
                href={ap(`/admin/campaigns/new?scenario=${scenario.kind}`)}
                className="hidden md:inline-block px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95"
              >
                Create the first one
              </Link>
            </RequireWrite>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map(c => {
              const ov = overrides[c.kind] || {}
              return (
                <div key={c.kind} className="bg-surface-elevated rounded-xl border border-border-default p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-foreground">{c.name}</h3>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                            c.enabled
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {c.enabled ? 'Active' : 'Paused'}
                        </span>
                        {c.discount_percent > 0 && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {c.discount_percent}% off
                          </span>
                        )}
                      </div>
                      {c.description && <p className="text-xs text-foreground-muted mt-1">{c.description}</p>}
                    </div>
                    <Link
                      href={ap(`/admin/campaigns/${c.kind}`)}
                      className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-xs font-semibold transition-all"
                    >
                      Edit template
                    </Link>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-foreground-muted">Sent: </span>
                      <span className="font-medium text-foreground tabular-nums">
                        {c.total_sent.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Opened: </span>
                      <span className="font-medium text-foreground tabular-nums">
                        {rate(c.total_opened, c.total_sent)}
                      </span>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Clicked: </span>
                      <span className="font-medium text-foreground tabular-nums">
                        {rate(c.total_clicked, c.total_sent)}
                      </span>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Converted: </span>
                      <span className="font-medium text-green-600 dark:text-green-400 tabular-nums">
                        {rate(c.total_converted, c.total_sent)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border-default">
                    <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-2">
                      Parameter overrides for this campaign
                    </p>
                    <p className="text-[10px] text-foreground-muted mb-3">
                      Leave a field blank to use the scenario default. Only set values that should differ from the
                      default.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(scenario.param_schema).map(([key, def]) => {
                        const defaultVal = scenario.default_parameters[key]
                        const overrideVal = ov[key]
                        const isOverridden = overrideVal !== undefined && overrideVal !== null
                        return (
                          <div key={key}>
                            <label className="block text-xs font-semibold text-foreground-muted mb-1">
                              {def.label}
                              {isOverridden && (
                                <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold rounded bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                                  OVERRIDDEN
                                </span>
                              )}
                            </label>
                            {def.type === 'boolean' ? (
                              <AdminSelect
                                value={isOverridden ? String(overrideVal) : ''}
                                onChange={v => {
                                  if (v === '') setOverrideValue(c.kind, key, null)
                                  else setOverrideValue(c.kind, key, v === 'true')
                                }}
                                options={[
                                  { value: '', label: `Default (${String(defaultVal)})` },
                                  { value: 'true', label: 'true' },
                                  { value: 'false', label: 'false' },
                                ]}
                              />
                            ) : (
                              <input
                                type="number"
                                value={isOverridden ? String(overrideVal) : ''}
                                placeholder={`Default: ${String(defaultVal)}`}
                                min={def.min}
                                max={def.max}
                                onChange={e => {
                                  const raw = e.target.value
                                  if (raw === '') setOverrideValue(c.kind, key, null)
                                  else
                                    setOverrideValue(
                                      c.kind,
                                      key,
                                      def.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw)
                                    )
                                }}
                                className="field-normal w-full border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                              />
                            )}
                            {def.description && (
                              <p className="text-[10px] text-foreground-muted mt-1">{def.description}</p>
                            )}
                            {(def.min !== undefined || def.max !== undefined) && (
                              <p className="text-[10px] text-foreground-muted mt-0.5">
                                Range: {def.min ?? '-∞'} to {def.max ?? '∞'}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <RequireWrite scope="campaigns:write">
                        <button
                          type="button"
                          onClick={() => saveOverrides(c.kind)}
                          disabled={savingKey === c.kind}
                          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                        >
                          {savingKey === c.kind ? 'Saving…' : 'Save overrides'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrides(o => ({ ...o, [c.kind]: {} }))
                          }}
                          className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
                        >
                          Reset to defaults
                        </button>
                      </RequireWrite>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
