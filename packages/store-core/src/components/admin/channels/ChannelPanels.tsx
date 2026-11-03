'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, Settings2, X } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { CHANNEL_INFO } from '@/lib/channels/types'
import type { ChannelAlertRow } from '@/lib/channels/alerts-engine'
import type { ChangeRow } from '@/lib/channels/change-log'
import type { SyncLogRow } from '@/lib/channels/sync-run'
import type { Channel } from '@/lib/channels/types'
import { Badge, Section, Table, api, btnGhost, btnPrimary, inputCls, when } from './ui'

// Alerts, Change history and Job runs tabs, the same for every channel console.

const SEV = {
  critical: 'border-red-500/40 bg-red-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-border-default bg-surface',
}

interface AlertsPayload {
  alerts: ChannelAlertRow[]
  config: Record<string, Record<string, number | boolean>> | null
  labels: Record<string, string>
  emails: boolean
}

export function ChannelAlerts({ channel, params }: { channel: Channel; params?: Record<string, string> }) {
  const canWrite = useCanWrite(CHANNEL_INFO[channel].readScope.replace(':read', ':write'))
  const [d, setD] = useState<AlertsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const url = `/api/admin/channels/${channel}/alerts`

  const load = useCallback(async () => {
    const r = await api<AlertsPayload>(url)
    if (r.ok) setD(r.data)
    else setError(r.data.error || 'Could not load alerts')
  }, [url])
  useEffect(() => {
    load()
  }, [load])

  const open = d?.alerts.filter(a => a.status === 'open') ?? []
  const dismissed = d?.alerts.filter(a => a.status === 'dismissed').length ?? 0

  return (
    <Section
      title={`Alerts${open.length ? ` (${open.length})` : ''}`}
      action={canWrite && d?.config ? <IconButton icon={Settings2} label="Alert settings" onClick={() => setEditing(e => !e)} /> : undefined}
    >
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !d ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : open.length === 0 ? (
        <p className="text-sm text-foreground-muted flex items-center gap-2">
          <BellRing className="w-4 h-4" /> No open alerts{dismissed ? `; ${dismissed} dismissed alert(s) stay quiet until they clear` : ''}.
        </p>
      ) : (
        <ul className="space-y-2">
          {open.map(a => (
            <li key={a.id} className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${SEV[a.severity] ?? SEV.info}`}>
              <div className="flex-1 min-w-0 break-words">
                <p className="font-medium">{a.title}</p>
                {a.message && <p className="text-xs text-foreground-muted">{a.message}</p>}
                <p className="text-[11px] text-foreground-muted mt-0.5">Since {when(a.first_seen_at)}</p>
              </div>
              {canWrite && (
                <button
                  type="button"
                  aria-label="Dismiss alert"
                  disabled={busy === a.id}
                  onClick={async () => {
                    setBusy(a.id)
                    await api(`${url}/${a.id}`, { method: 'DELETE' })
                    setBusy(null)
                    load()
                  }}
                  className="text-foreground-muted hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && d?.config && (
        <AlertSettings
          d={d}
          params={params}
          busy={busy === 'save'}
          onSave={async (config, emails) => {
            setBusy('save')
            const r = await api(url, { method: 'PUT', json: { config, emails } })
            setBusy(null)
            if (r.ok) {
              setEditing(false)
              load()
            } else setError(r.data.error || 'Could not save')
          }}
        />
      )}
    </Section>
  )
}

function AlertSettings({
  d,
  params = {},
  busy,
  onSave,
}: {
  d: AlertsPayload
  params?: Record<string, string>
  busy: boolean
  onSave: (c: AlertsPayload['config'], emails: boolean) => void
}) {
  const [config, setConfig] = useState(d.config!)
  const [emails, setEmails] = useState(d.emails)
  const set = (rule: string, key: string, value: number | boolean) => setConfig(c => ({ ...c, [rule]: { ...c[rule], [key]: value } }))
  return (
    <div className="mt-4 border-t border-border-default pt-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Object.keys(config).map(rule => {
          const r = config[rule]
          return (
            <div key={rule} className="rounded-lg border border-border-default p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={!!r.enabled} onChange={e => set(rule, 'enabled', e.target.checked)} />
                {d.labels[rule] ?? rule}
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(r)
                  .filter(([k]) => k !== 'enabled')
                  .map(([k, v]) => (
                    <label key={k} className="text-xs text-foreground-muted flex flex-col gap-1 w-36">
                      {params[k] ?? k}
                      <input type="number" className={inputCls} value={Number(v)} disabled={!r.enabled} onChange={e => set(rule, k, Number(e.target.value))} />
                    </label>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={emails} onChange={e => setEmails(e.target.checked)} />
        Email new alerts to admins who can see this page (they always appear in the bell)
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" className={btnGhost} onClick={() => setConfig(d.config!)}>
          Reset
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => onSave(config, emails)}>
          Save
        </button>
      </div>
    </div>
  )
}

const statusTone = (s: string) => (s === 'applied' || s === 'success' ? 'green' : s === 'partial' || s === 'running' ? 'amber' : 'red')

export function ChangeHistory({ channel }: { channel: Channel }) {
  const [rows, setRows] = useState<ChangeRow[] | null>(null)
  useEffect(() => {
    api<{ changes: ChangeRow[] }>(`/api/admin/channels/${channel}/changes`).then(r => setRows(r.data.changes ?? []))
  }, [channel])
  return (
    <Section title="Change history">
      {!rows ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : (
        <Table
          rows={rows}
          rowKey={r => r.id}
          empty="No changes made from this console yet."
          cols={[
            { key: 'when', label: 'When', render: r => <span className="whitespace-nowrap">{when(r.created_at)}</span>, sort: r => r.created_at },
            { key: 'who', label: 'By', render: r => r.admin_email ?? '-' },
            { key: 'what', label: 'Change', render: r => r.summary },
            {
              key: 'status',
              label: 'Result',
              render: r => (
                <span title={r.error ?? undefined}>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </span>
              ),
            },
          ]}
        />
      )}
    </Section>
  )
}

export function JobRuns({ channel, labels = {} }: { channel: Channel; labels?: Record<string, string> }) {
  const [rows, setRows] = useState<SyncLogRow[] | null>(null)
  useEffect(() => {
    api<{ runs: SyncLogRow[] }>(`/api/admin/channels/${channel}/runs`).then(r => setRows(r.data.runs ?? []))
  }, [channel])
  return (
    <Section title="Job runs">
      {!rows ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : (
        <Table
          rows={rows}
          rowKey={r => r.id}
          empty="No runs yet."
          cols={[
            { key: 'when', label: 'Started', render: r => <span className="whitespace-nowrap">{when(r.started_at)}</span>, sort: r => r.started_at },
            { key: 'kind', label: 'Job', render: r => labels[r.kind] ?? r.kind },
            { key: 'status', label: 'Status', render: r => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
            {
              key: 'counts',
              label: 'Rows',
              render: r =>
                Object.entries(r.counts ?? {})
                  .map(([k, v]) => `${k} ${v}`)
                  .join(', ') || '-',
            },
            {
              key: 'errors',
              label: 'Errors',
              render: r =>
                r.errors?.length ? (
                  <span className="text-xs text-red-500">{r.errors.map(e => `${e.step}: ${e.message}`).join('; ')}</span>
                ) : (
                  '-'
                ),
            },
          ]}
        />
      )}
    </Section>
  )
}
