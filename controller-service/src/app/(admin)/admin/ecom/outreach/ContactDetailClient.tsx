'use client'

import { useCallback, useEffect, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, when } from '@/components/admin/kit/core'
import { Card, Field, Fields } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import type { OutreachCall, OutreachContact, OutreachEvent, OutreachMessage } from '@controller/lib/outreach/types'
import CallPanelClient from './CallPanelClient'
import { StatusChip } from './OutreachContactsClient'
import { API, LANGUAGE_LABEL, maskPhone } from './shared'

type Detail = { contact: OutreachContact; calls: OutreachCall[]; messages: OutreachMessage[]; events: OutreachEvent[] }
type Action = 'requeue' | 'not_interested' | 'suppress'

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v)

/** Preview / live / claim links the pipeline recorded on the audit trail, newest first wins. */
export function linksFromEvents(events: OutreachEvent[]): { preview?: string; live?: string; claim?: string } {
  const out: { preview?: string; live?: string; claim?: string } = {}
  for (const e of events) {
    const d = e.data ?? {}
    if (!out.preview && isUrl(d.previewUrl)) out.preview = d.previewUrl
    if (!out.live && isUrl(d.liveUrl)) out.live = d.liveUrl
    if (!out.claim && isUrl(d.claimUrl)) out.claim = d.claimUrl
  }
  return out
}

const claimState = (c: OutreachContact) => (c.claimed_owner_id ? 'Claimed' : c.claim_token_hash ? 'Claim link issued, not claimed yet' : 'No claim link yet')

export default function ContactDetailClient({ contactId }: { contactId: string }) {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Action | null>(null)

  const load = useCallback(async () => {
    const { ok, data } = await api<Detail>(`${API}/contacts/${contactId}`)
    if (!ok) return setError(data.error || 'Could not load the contact')
    setD(data)
  }, [contactId])
  useEffect(() => {
    load()
  }, [load])

  async function act(action: Action) {
    setBusy(action)
    const { ok, data } = await api<Detail>(`${API}/contacts/${contactId}`, { method: 'PATCH', json: { action } })
    setBusy(null)
    if (!ok) return toast.error(data.error || 'Could not update the contact')
    setD(data)
    toast.success('Updated')
  }

  if (error) return <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!d) return <div className="mt-4 h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />
  const { contact: c, calls, messages, events } = d
  const links = linksFromEvents(events)
  const consent = c.consent_whatsapp_at ? `Given ${when(c.consent_whatsapp_at)}` : 'Not given'

  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground break-words">{c.business_name}</h1>
          <p className="text-sm text-foreground-muted mt-1">
            {maskPhone(c.phone)} · {c.city || 'No city'} · {(c.language && LANGUAGE_LABEL[c.language]) || 'No language'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={c.status} />
          {canWrite && (
            <>
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => act('requeue')}>
                Requeue
              </button>
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => act('not_interested')}>
                Not interested
              </button>
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => act('suppress')}>
                Suppress
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Contact">
          <Fields>
            <Field label="Owner" value={c.owner_name || '-'} />
            <Field label="Category" value={c.category || '-'} />
            <Field label="Attempts" value={`${c.attempts}`} />
            <Field label="Next attempt" value={when(c.next_attempt_at)} />
            <Field label="DND" value={c.dnd_status} />
            <Field label="Opted out" value={c.opted_out_at ? when(c.opted_out_at) : 'No'} />
          </Fields>
        </Card>
        <div id="site">
          <Card title="Site and claim">
            <Fields cols={1}>
              <Field label="Site" value={c.showcase_site_id ? <span className="font-mono text-xs">{c.showcase_site_id}</span> : 'Not built yet'} />
              <Field label="Preview link" value={links.preview ? <a className="text-accent-500 hover:underline break-all" href={links.preview} target="_blank" rel="noreferrer">{links.preview}</a> : '-'} />
              <Field label="Live link" value={links.live ? <a className="text-accent-500 hover:underline break-all" href={links.live} target="_blank" rel="noreferrer">{links.live}</a> : '-'} />
              <Field label="Claim" value={claimState(c)} />
            </Fields>
          </Card>
        </div>
        <Card title="WhatsApp consent" hint="Recorded before any WhatsApp message is sent.">
          <p className="text-sm text-foreground">{consent}</p>
          {c.consent_evidence && <pre className="mt-2 text-xs whitespace-pre-wrap break-words rounded-lg bg-surface-secondary p-2">{JSON.stringify(c.consent_evidence, null, 2)}</pre>}
        </Card>
        <Card title="WhatsApp messages" flush>
          {!messages.length ? (
            <p className="px-5 pb-5 text-sm text-foreground-muted">No messages yet.</p>
          ) : (
            <ul className="divide-y divide-border-default/60">
              {messages.map(m => (
                <li key={m.id} className="px-5 py-2.5 text-sm">
                  <div className="flex items-center gap-2 text-xs text-foreground-muted">
                    <Badge tone={m.direction === 'in' ? 'blue' : 'muted'}>{m.direction === 'in' ? 'In' : 'Out'}</Badge>
                    <span>{when(m.created_at)}</span>
                    {m.status && <span>{m.status}</span>}
                    {m.template_slug && <span className="truncate">{m.template_slug}</span>}
                  </div>
                  {m.body && <p className="mt-1 break-words">{m.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Calls</h2>
        {!calls.length && <p className="text-sm text-foreground-muted">No calls yet.</p>}
        {calls.map(call => (
          <div key={call.id} className="rounded-xl border border-border-default bg-surface-elevated p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={call.status === 'completed' ? 'green' : call.status === 'failed' ? 'red' : 'muted'}>{call.status}</Badge>
              <span className="text-foreground-muted">{when(call.started_at ?? call.created_at)}</span>
              {call.outcome && <span className="text-foreground-muted">{call.outcome.replace(/_/g, ' ')}</span>}
            </div>
            <CallPanelClient callId={call.id} />
          </div>
        ))}
      </div>

      <Card title="Timeline" flush>
        {!events.length ? (
          <p className="px-5 pb-5 text-sm text-foreground-muted">No events.</p>
        ) : (
          <ol className="divide-y divide-border-default/60">
            {events.map(e => (
              <li key={e.id} className="px-5 py-2 text-sm flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-medium text-foreground">{e.kind.replace(/[._]/g, ' ')}</span>
                <span className="text-xs text-foreground-muted">{when(e.created_at)}</span>
                {e.actor && <span className="text-xs text-foreground-muted">{e.actor}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}
