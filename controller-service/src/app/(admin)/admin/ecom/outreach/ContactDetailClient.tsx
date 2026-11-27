'use client'

import { useCallback, useEffect, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, inputCls, when } from '@/components/admin/kit/core'
import { Card, Field, Fields } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import type { AgentRunRow, AgentTaskRow } from '@controller/lib/outreach/agent/types'
import type { OutreachCall, OutreachContact, OutreachEvent, OutreachMessage } from '@controller/lib/outreach/types'
import CallPanelClient from './CallPanelClient'
import { StatusChip } from './OutreachContactsClient'
import type { Tone } from '@/components/admin/kit/tones'
import { API, CHANNEL_LABEL, inr, LANGUAGE_LABEL, maskPhone } from './shared'

type Detail = { contact: OutreachContact; calls: OutreachCall[]; messages: OutreachMessage[]; events: OutreachEvent[]; agent?: { run: AgentRunRow | null; tasks: AgentTaskRow[] } }
type Action = 'requeue' | 'not_interested' | 'suppress' | 'handoff' | 'resume'

const RUN_TONE: Record<AgentRunRow['status'], Tone> = { active: 'green', handed_off: 'amber', completed: 'muted', stopped: 'red' }
const RUN_LABEL: Record<AgentRunRow['status'], string> = { active: 'Active', handed_off: 'Handed off', completed: 'Completed', stopped: 'Stopped' }
const TASK_TONE: Record<AgentTaskRow['status'], Tone> = { pending: 'blue', running: 'blue', done: 'green', cancelled: 'muted', failed: 'red' }
const truncate = (t: string | null, n = 80) => (!t ? '-' : t.length > n ? `${t.slice(0, n)}…` : t)

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v)

/** Preview / live links and the claim link's expiry the pipeline recorded on the audit trail, newest first wins. The claim link itself is never stored. */
export function linksFromEvents(events: OutreachEvent[]): { preview?: string; live?: string; claimExpiresAt?: string } {
  const out: { preview?: string; live?: string; claimExpiresAt?: string } = {}
  for (const e of events) {
    const d = e.data ?? {}
    if (!out.preview && isUrl(d.previewUrl)) out.preview = d.previewUrl
    if (!out.live && isUrl(d.liveUrl)) out.live = d.liveUrl
    const exp = d.claimExpiresAt ?? d.expires_at
    if (!out.claimExpiresAt && typeof exp === 'string' && !Number.isNaN(Date.parse(exp))) out.claimExpiresAt = exp
  }
  return out
}

const claimState = (c: OutreachContact, expiresAt?: string) =>
  c.claimed_owner_id ? 'Claimed' : c.claim_token_hash ? `Claim link sent${expiresAt ? ` · expires ${when(expiresAt)}` : ''}` : 'No claim link yet'

export default function ContactDetailClient({ contactId }: { contactId: string }) {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Action | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    const { ok, data } = await api<Detail>(`${API}/contacts/${contactId}`)
    if (!ok) return setError(data.error || 'Could not load the contact')
    setD(data)
  }, [contactId])
  useEffect(() => {
    load()
  }, [load])

  async function act(action: Action, note?: string) {
    setBusy(action)
    const { ok, data } = await api<Detail>(`${API}/contacts/${contactId}`, { method: 'PATCH', json: { action, ...(note ? { note } : {}) } })
    setBusy(null)
    if (!ok) return toast.error(data.error || 'Could not update the contact')
    setD(data)
    if (action === 'handoff' || action === 'resume') {
      setReason('')
      if (!data.agent) load()
    }
    toast.success(action === 'handoff' ? 'Handed off to the team' : action === 'resume' ? 'Agent resumed' : 'Updated')
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
              <Field label="Claim" value={claimState(c, links.claimExpiresAt)} />
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

      {d.agent && <AgentCard contact={c} agent={d.agent} canWrite={canWrite} busy={busy} reason={reason} setReason={setReason} act={act} />}

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

function AgentCard({ contact: c, agent, canWrite, busy, reason, setReason, act }: {
  contact: OutreachContact
  agent: { run: AgentRunRow | null; tasks: AgentTaskRow[] }
  canWrite: boolean
  busy: Action | null
  reason: string
  setReason: (s: string) => void
  act: (a: Action, note?: string) => void
}) {
  const { run, tasks } = agent
  const handedOff = !!c.handoff_at || run?.status === 'handed_off'
  return (
    <Card
      title="Agent"
      hint="The AI agent's run for this contact: where it is, what it has scheduled and when a person took over."
      action={run && <Badge tone={RUN_TONE[run.status]}>{RUN_LABEL[run.status]}</Badge>}
    >
      <div className="space-y-4">
        {!run ? (
          <p className="text-sm text-foreground-muted">The agent has not started on this contact yet.</p>
        ) : (
          <Fields cols={3}>
            <Field label="Skill" value={<span className="font-mono text-xs break-all">{run.skill_ref}</span>} />
            <Field label="Turns" value={`${run.turns}`} />
            <Field label="Spend" value={<span className="tabular-nums">{inr(run.spend_paise)}</span>} />
            <Field label="Last channel" value={run.last_channel ? CHANNEL_LABEL[run.last_channel] ?? run.last_channel : '-'} />
            <Field label="Last turn" value={when(run.last_turn_at)} />
            <Field label="Started" value={when(run.started_at)} />
          </Fields>
        )}

        {handedOff && (
          <p className="rounded-lg bg-surface-secondary p-3 text-sm">
            Handed off to the team{c.handoff_at ? ` on ${when(c.handoff_at)}` : ''}. {c.handoff_reason ? `Reason: ${c.handoff_reason}` : 'No reason recorded.'} The agent stays quiet until you resume it.
          </p>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-1">Scheduled tasks</h3>
          {!tasks.length ? (
            <p className="text-sm text-foreground-muted">No tasks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                    <th className="py-1.5 pr-3">Kind</th>
                    <th className="py-1.5 pr-3">Due</th>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5 pr-3">Reason</th>
                    <th className="py-1.5 pr-3">Instruction</th>
                    <th className="py-1.5">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(t => (
                    <tr key={t.id} className="border-t border-border-default/60 align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{t.kind === 'call' ? 'Call' : 'WhatsApp turn'}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{when(t.due_at)}</td>
                      <td className="py-1.5 pr-3"><Badge tone={TASK_TONE[t.status]}>{t.status}</Badge></td>
                      <td className="py-1.5 pr-3">{t.reason || '-'}</td>
                      <td className="py-1.5 pr-3 max-w-xs" title={t.instruction ?? undefined}>{truncate(t.instruction)}</td>
                      <td className="py-1.5 tabular-nums">{t.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {canWrite && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {handedOff ? (
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => act('resume')}>
                Resume agent
              </button>
            ) : (
              <>
                <input aria-label="Hand-off reason" className={`${inputCls} sm:max-w-sm`} placeholder="Reason (optional)" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} />
                <button type="button" className={btnGhost} disabled={!!busy} onClick={() => act('handoff', reason.trim() || undefined)}>
                  Hand off to team
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
