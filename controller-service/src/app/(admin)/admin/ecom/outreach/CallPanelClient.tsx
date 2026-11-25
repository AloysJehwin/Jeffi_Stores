'use client'

import { useEffect, useState } from 'react'
import { api, Badge, btnGhost, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import type { OutreachCall, OutreachEvent } from '@controller/lib/outreach/types'
import { API } from './shared'

// GET /api/admin/ecom/outreach/calls/{id}: the call row plus a signed recording URL, consent and events.
// The reader is tolerant of the exact envelope: { call, recordingUrl, events } or the row with extras on top.
type CallView = OutreachCall & { recordingUrl?: string | null; recording_url?: string | null; recording?: string | { url?: string } | null; events?: OutreachEvent[] }

const recordingOf = (c: CallView): string | null => {
  const r = c.recordingUrl ?? c.recording_url ?? (typeof c.recording === 'string' ? c.recording : c.recording?.url)
  return r || null
}

type Turn = { who: string; text: string }
export function transcriptTurns(t: unknown): Turn[] {
  const list = typeof t === 'string' ? (() => { try { return JSON.parse(t) } catch { return [] } })() : t
  if (!Array.isArray(list)) return []
  return list
    .map((x: any) => ({ who: String(x?.role ?? x?.speaker ?? x?.who ?? ''), text: String(x?.text ?? x?.content ?? x?.message ?? '') }))
    .filter(x => x.text)
}

export default function CallPanelClient({ callId, defaultOpen = false }: { callId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [call, setCall] = useState<CallView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || call) return
    api<any>(`${API}/calls/${callId}`).then(({ ok, data }) => {
      if (!ok) return setError(data.error || 'Could not load the call')
      const row = data.call ?? data
      setCall({ ...row, recordingUrl: data.recordingUrl ?? data.recording_url ?? data.recording ?? row.recordingUrl, events: data.events ?? row.events })
    })
  }, [open, call, callId])

  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        Show transcript and recording
      </button>
    )
  }
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!call) return <div className="h-24 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />
  const turns = transcriptTurns(call.transcript)
  const rec = recordingOf(call)
  return (
    <Card
      title={`Call ${call.status}${call.outcome ? ` · ${call.outcome.replace(/_/g, ' ')}` : ''}`}
      hint={`${when(call.started_at ?? call.created_at)}${call.duration_s != null ? ` · ${call.duration_s}s` : ''}${call.language ? ` · ${call.language}` : ''}`}
    >
      <div className="space-y-4">
        {call.summary && <p className="text-sm text-foreground">{call.summary}</p>}
        {call.error && <p className="text-sm text-red-600 dark:text-red-400">{call.error}</p>}
        {rec ? (
          <audio controls preload="none" src={rec} className="w-full" aria-label="Call recording" />
        ) : (
          <p className="text-xs text-foreground-muted">No recording.</p>
        )}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Transcript</h3>
          {turns.length ? (
            <ol className="space-y-1.5 text-sm">
              {turns.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <Badge tone={/user|caller|customer|human/i.test(t.who) ? 'blue' : 'muted'}>{t.who || '-'}</Badge>
                  <span className="min-w-0 break-words">{t.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-foreground-muted">No transcript.</p>
          )}
        </div>
        {call.consent && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Consent</h3>
            <pre className="text-xs whitespace-pre-wrap break-words rounded-lg bg-surface-secondary p-2">{JSON.stringify(call.consent, null, 2)}</pre>
          </div>
        )}
        {!!call.events?.length && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Call events</h3>
            <ul className="text-xs text-foreground-muted space-y-0.5">
              {call.events.map(e => (
                <li key={e.id}>
                  {when(e.created_at)} · {e.kind}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
