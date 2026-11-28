'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, when } from '@/components/admin/kit/core'
import { Card, Field, Fields } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import type { AgentRunRow, JobRow } from '@controller/lib/outreach/agent/types'
import CallPanelClient from './CallPanelClient'
import { API, BASE, CHANNEL_LABEL, inr, JOB_STATUS_LABEL, JOB_STATUS_TONE, LANGUAGE_LABEL, maskPhone, slugLabel, SOURCE_LABEL } from './shared'

export const JobStatusChip = ({ status }: { status: string }) => <Badge tone={JOB_STATUS_TONE[status] ?? 'muted'}>{JOB_STATUS_LABEL[status] ?? status}</Badge>

type Row = Record<string, any>
type Detail = {
  job: JobRow
  contact: { id: string; kind: string; phone: string; owner_name: string | null; business_name: string | null; language: string | null; status: string; consent_whatsapp_at: string | null; opted_out_at: string | null; dnd_status: string | null; handoff_at: string | null; handoff_reason: string | null }
  run: AgentRunRow | null
  calls: Row[]
  messages: Row[]
  toolCalls: Row[]
}

const PHONE_LIKE = /^\+?\d{10,14}$/
const show = (v: unknown): string => (v == null || v === '' ? '-' : typeof v === 'string' ? (PHONE_LIKE.test(v) ? maskPhone(v) : v) : typeof v === 'object' ? JSON.stringify(v) : String(v))
const OPEN = ['queued', 'active', 'waiting']

/** One job: inputs, resolved references, contact, status with Cancel / Retry, calls, messages and the tool call timeline. */
export default function JobDetailClient({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const { ok, data } = await api<Detail>(`${API}/jobs/${jobId}`)
    if (!ok) return setError(data.error || 'Could not load the job')
    setError(null)
    setD(data)
  }, [jobId])
  useEffect(() => {
    load()
  }, [load])

  async function act(action: 'cancel' | 'retry') {
    setBusy(action)
    const { ok, data } = await api(`${API}/jobs/${jobId}`, { method: 'PATCH', json: { action } })
    setBusy(null)
    setConfirming(false)
    if (!ok) return toast.error(data.error || `Could not ${action} the job`)
    toast.success(action === 'cancel' ? 'Job cancelled' : 'Job queued again')
    await load()
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!d) return <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />
  const { job, contact: c, run, calls, messages, toolCalls } = d
  const open = OPEN.includes(job.status)
  const canRetry = job.status === 'failed' || job.status === 'cancelled'
  const inputs = Object.entries(job.inputs ?? {})
  const refs = Object.entries(job.refs ?? {}) as [string, Row][]
  const name = c.owner_name || c.business_name || '-'

  return (
    <div className="space-y-5">
      <Card
        title="Job"
        hint={`${SOURCE_LABEL[job.source] ?? job.source} · created ${when(job.created_at)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusChip status={job.status} />
            {job.outcome && <Badge tone="blue">{slugLabel(job.outcome)}</Badge>}
            <button type="button" className={btnGhost} onClick={onBack}>
              Back to jobs
            </button>
            {canWrite && open && !confirming && (
              <button type="button" className={btnGhost} onClick={() => setConfirming(true)}>
                Cancel job
              </button>
            )}
            {confirming && (
              <>
                <span className="text-xs text-foreground-muted">The agent stops and nothing more is sent.</span>
                <button type="button" className={btnGhost} disabled={busy === 'cancel'} onClick={() => act('cancel')}>
                  Confirm cancel
                </button>
                <button type="button" className={btnGhost} onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </>
            )}
            {canWrite && canRetry && (
              <button type="button" className={btnGhost} disabled={busy === 'retry'} onClick={() => act('retry')}>
                Retry
              </button>
            )}
          </div>
        }
      >
        <Fields cols={3}>
          <Field label="Due" value={when(job.due_at)} />
          <Field label="Ended" value={when(job.ended_at)} />
          <Field label="Attempts" value={`${job.attempts}`} />
          <Field label="Source ref" value={job.source_ref ?? '-'} mono />
          <Field label="Outcome" value={slugLabel(job.outcome)} />
          <Field label="Updated" value={when(job.updated_at)} />
        </Fields>
        {job.result && !!Object.keys(job.result).length && (
          <pre aria-label="Job result" className="mt-3 max-h-48 overflow-auto rounded-lg bg-surface-secondary p-3 text-xs font-mono whitespace-pre-wrap break-words">{JSON.stringify(job.result, null, 2)}</pre>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Card title="Contact">
          <Fields cols={2}>
            <Field label="Name" value={name} />
            <Field label="Phone" value={<span className="tabular-nums">{maskPhone(c.phone)}</span>} />
            <Field label="Language" value={(c.language && LANGUAGE_LABEL[c.language]) || '-'} />
            <Field label="Status" value={slugLabel(c.status)} />
            <Field label="WhatsApp consent" value={c.consent_whatsapp_at ? `Given ${when(c.consent_whatsapp_at)}` : 'Not given'} />
            <Field label="DND" value={c.dnd_status ?? '-'} />
            {c.opted_out_at && <Field label="Opted out" value={when(c.opted_out_at)} />}
            {c.handoff_at && <Field label="Handed off" value={`${when(c.handoff_at)}${c.handoff_reason ? ` · ${c.handoff_reason}` : ''}`} />}
          </Fields>
          <Link href={`${BASE}/contacts/${c.id}`} className="mt-3 inline-block text-xs text-accent-500 hover:underline">
            Open the contact
          </Link>
        </Card>

        <Card title="Inputs">
          {!inputs.length ? (
            <p className="text-sm text-foreground-muted">No inputs.</p>
          ) : (
            <dl className="space-y-1">
              {inputs.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-sm">
                  <dt className="w-36 shrink-0 font-mono text-xs text-foreground-muted pt-0.5 break-words">{k}</dt>
                  <dd className="min-w-0 break-words">{show(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      {!!refs.length && (
        <Card title="Resolved references" hint="What the agent sees about the order, checkout, product or customer.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {refs.map(([kind, r]) => (
              <div key={kind} className="rounded-lg bg-surface-secondary p-3 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{kind}</div>
                {Object.entries(r)
                  .filter(([k]) => k !== 'id' && k !== 'key')
                  .map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-sm">
                      <span className="w-28 shrink-0 text-xs text-foreground-muted pt-0.5">{k}</span>
                      <span className="min-w-0 break-words">{typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? when(v) : show(v)}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {run && (
        <Card title="Run" hint="The agent's run for this job.">
          <Fields cols={3}>
            <Field label="Agent version" value={<span className="font-mono text-xs break-all">{run.skill_ref}</span>} />
            <Field label="Status" value={slugLabel(run.status)} />
            <Field label="Turns" value={`${run.turns}`} />
            <Field label="Spend" value={<span className="tabular-nums">{inr(run.spend_paise)}</span>} />
            <Field label="Last channel" value={run.last_channel ? CHANNEL_LABEL[run.last_channel] ?? run.last_channel : '-'} />
            <Field label="Started" value={when(run.started_at)} />
          </Fields>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Calls</h2>
        {!calls.length && <p className="text-sm text-foreground-muted">No calls yet.</p>}
        {calls.map(call => (
          <div key={call.id} className="rounded-xl border border-border-default bg-surface-elevated p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={call.status === 'completed' ? 'green' : call.status === 'failed' ? 'red' : 'muted'}>{call.status}</Badge>
              <span className="text-foreground-muted">{when(call.started_at ?? call.created_at)}</span>
              {call.outcome && <span className="text-foreground-muted">{slugLabel(call.outcome)}</span>}
              {call.duration_s != null && <span className="text-foreground-muted tabular-nums">{`${call.duration_s}s`}</span>}
            </div>
            {call.summary && <p className="text-sm">{call.summary}</p>}
            <CallPanelClient callId={call.id} />
          </div>
        ))}
      </div>

      <Card title="Messages" flush>
        {!messages.length ? (
          <p className="px-5 pb-5 text-sm text-foreground-muted">No messages.</p>
        ) : (
          <ul className="divide-y divide-border-default/60">
            {messages.map(m => (
              <li key={m.id} className="px-5 py-2 text-sm space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                  <Badge tone={m.direction === 'inbound' ? 'blue' : 'muted'}>{m.direction === 'inbound' ? 'In' : 'Out'}</Badge>
                  <span>{when(m.created_at)}</span>
                  {m.template_slug && <span className="font-mono">{m.template_slug}</span>}
                  {m.status && <span>{m.status}</span>}
                </div>
                {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Tool calls" hint="What the agent did, in order." flush>
        {!toolCalls.length ? (
          <p className="px-5 pb-5 text-sm text-foreground-muted">No tool calls.</p>
        ) : (
          <ol className="divide-y divide-border-default/60">
            {toolCalls.map(t => {
              const data = (t.data ?? {}) as Row
              return (
                <li key={t.id} className="px-5 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium">{data.tool ?? 'tool'}</span>
                    <Badge tone={data.ok ? 'green' : 'red'}>{data.ok ? 'ok' : 'failed'}</Badge>
                    {data.channel && <span className="text-xs text-foreground-muted">{CHANNEL_LABEL[data.channel] ?? data.channel}</span>}
                    <span className="text-xs text-foreground-muted">{when(t.created_at)}</span>
                  </div>
                  {data.error && <p className="text-xs text-red-600 dark:text-red-400">{String(data.error)}</p>}
                  {data.say && <p className="text-xs text-foreground-muted">{`Said: ${data.say}`}</p>}
                  {data.args && Object.keys(data.args).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-foreground-muted">Arguments</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-secondary p-2 whitespace-pre-wrap break-words">{JSON.stringify(data.args, null, 2)}</pre>
                    </details>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </Card>
    </div>
  )
}
