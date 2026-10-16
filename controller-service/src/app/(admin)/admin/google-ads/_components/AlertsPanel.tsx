'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, Mail, RefreshCw, Settings2, X } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { AlertConfig, AlertRow, NotifySettings } from '@/lib/google-ads/alerts'
import { inputCls, btnGhost, btnPrimary } from './wizard/fields'

// Overview > Alerts: what the rules after each sync found, with the per-store thresholds.

const RULE_LABEL: Record<keyof AlertConfig, string> = {
  budget_pacing: 'Budget pacing',
  spend_spike: 'Spend spike vs the 7-day average',
  cpa_roas_target: 'CPA / ROAS outside your target',
  zero_conversions: 'No conversions while spending',
  tracking_stopped: 'Tracking stopped (no click-id orders)',
  disapproved_ads: 'Newly disapproved ads',
  merchant_disapproved: 'Merchant products disapproved with spend',
  out_of_stock_ads: 'Ads on out-of-stock items',
  account_problems: 'Account and billing problems',
}

const PARAM_LABEL: Record<string, string> = {
  pacePercent: '% of daily budget',
  beforeHour: 'before hour (0-23)',
  percent: '% above average',
  minSpend: 'minimum spend',
  maxCpa: 'max cost / conversion (0 = off)',
  minRoas: 'min ROAS (0 = off)',
  days: 'days',
  minClicks: 'minimum clicks',
  budgetPercent: '% of account budget used',
}

const SEV = {
  critical: 'border-red-500/40 bg-red-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-border-default bg-surface',
}

interface Payload {
  alerts: AlertRow[]
  config: AlertConfig
  notify: NotifySettings
}

export default function AlertsPanel() {
  const canWrite = useCanWrite('google_ads')
  const [d, setD] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/google-ads/alerts', { credentials: 'include' })
    const j = await r.json().catch(() => ({}))
    if (r.ok && Array.isArray(j.alerts)) setD(j)
    else setError(j.error || 'Could not load alerts')
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function send(method: 'POST' | 'PUT', body: unknown, key: string, url = '/api/admin/google-ads/alerts') {
    setBusy(key)
    setNotice(null)
    try {
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setNotice(j.error || 'Request failed')
      else if (url.endsWith('/alerts') && Array.isArray(j.alerts)) setD(j)
      return { ok: r.ok, data: j }
    } finally {
      setBusy(null)
    }
  }

  const open = d?.alerts.filter(a => a.status === 'open') ?? []
  const dismissed = d?.alerts.filter(a => a.status === 'dismissed').length ?? 0

  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
          <BellRing className="w-4 h-4" /> Alerts {open.length > 0 && <span className="text-accent-500">({open.length})</span>}
        </h2>
        {canWrite && (
          <div className="flex items-center gap-1">
            <IconButton icon={RefreshCw} label="Check alerts now" busy={busy === 'eval'} onClick={() => send('POST', { op: 'evaluate' }, 'eval')} />
            <IconButton
              icon={Mail}
              label="Email me the weekly digest now"
              busy={busy === 'digest'}
              onClick={async () => {
                const r = await send('POST', { to: 'me' }, 'digest', '/api/admin/google-ads/digest')
                if (r.ok) setNotice(`Digest sent to ${r.data.sent} address${r.data.sent === 1 ? '' : 'es'}.`)
              }}
            />
            <IconButton icon={Settings2} label="Alert settings" onClick={() => setEditing(e => !e)} />
          </div>
        )}
      </div>
      {notice && <p className="text-xs text-foreground-muted mb-2">{notice}</p>}
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !d ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : open.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No open alerts. Rules run after every sync{dismissed ? `; ${dismissed} dismissed alert(s) stay quiet until they clear` : ''}.
        </p>
      ) : (
        <ul className="space-y-2">
          {open.map(a => (
            <li key={a.id} className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${SEV[a.severity] ?? SEV.info}`}>
              <div className="flex-1">
                <p className="font-medium">{a.title}</p>
                {a.message && <p className="text-xs text-foreground-muted">{a.message}</p>}
                <p className="text-[11px] text-foreground-muted mt-0.5">Since {new Date(a.first_seen_at).toLocaleString('en-IN')}</p>
              </div>
              {canWrite && (
                <button
                  type="button"
                  aria-label="Dismiss alert"
                  disabled={busy === `d:${a.id}`}
                  onClick={() => send('POST', { op: 'dismiss', id: a.id }, `d:${a.id}`)}
                  className="text-foreground-muted hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && d && <AlertSettings d={d} busy={busy === 'save'} onSave={(config, notify) => send('PUT', { config, notify }, 'save').then(r => r.ok && setEditing(false))} />}
    </div>
  )
}

function AlertSettings({ d, busy, onSave }: { d: Payload; busy: boolean; onSave: (c: AlertConfig, n: NotifySettings) => void }) {
  const [config, setConfig] = useState<AlertConfig>(d.config)
  const [notify, setNotify] = useState<NotifySettings>(d.notify)
  const rules = Object.keys(RULE_LABEL) as (keyof AlertConfig)[]
  const set = (rule: keyof AlertConfig, key: string, value: number | boolean) =>
    setConfig(c => ({ ...c, [rule]: { ...(c[rule] as object), [key]: value } }) as AlertConfig)
  return (
    <div className="mt-4 border-t border-border-default pt-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {rules.map(rule => {
          const r = config[rule] as Record<string, number | boolean>
          return (
            <div key={rule} className="rounded-lg border border-border-default p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={!!r.enabled} onChange={e => set(rule, 'enabled', e.target.checked)} />
                {RULE_LABEL[rule]}
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(r)
                  .filter(([k]) => k !== 'enabled')
                  .map(([k, v]) => (
                    <label key={k} className="text-xs text-foreground-muted flex flex-col gap-1 w-36">
                      {PARAM_LABEL[k] ?? k}
                      <input
                        type="number"
                        className={inputCls}
                        value={Number(v)}
                        disabled={!r.enabled}
                        onChange={e => set(rule, k, Number(e.target.value))}
                      />
                    </label>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify.emails} onChange={e => setNotify(n => ({ ...n, emails: e.target.checked }))} />
        Email new alerts to admins who can see Google Ads (they always appear in the bell)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify.digest} onChange={e => setNotify(n => ({ ...n, digest: e.target.checked }))} />
        Weekly digest email (Mondays): spend, conversions, true ROAS / POAS, best and worst campaigns, wasted search terms
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" className={btnGhost} onClick={() => setConfig(d.config)}>
          Reset
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => onSave(config, notify)}>
          Save
        </button>
      </div>
    </div>
  )
}
