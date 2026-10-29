'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, Check, Globe, Mail, MessageSquareText, Paperclip, Smartphone, X } from 'lucide-react'
import { Card, badgeCls, fieldInputCls, useActionToast, type Tone } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'

// Customer replies about one record: what we asked, what came back by WhatsApp or email, how the
// assistant read it, and Approve / Reject on whatever waits for an admin.

interface Item {
  id: string
  kind: 'asked' | 'message' | 'action'
  at: string
  channel?: string
  sender?: string
  text?: string
  scenario?: string
  intent?: string
  title?: string
  reading?: string | null
  confidence?: number | null
  status?: string
  awaiting?: string
  autoApplied?: boolean
  manual?: boolean
  result?: string | null
  decidedBy?: string | null
  attachments?: Array<{ id: string; kind: string; name: string; url: string }>
}

const CHANNEL_ICON: Record<string, typeof Globe> = { whatsapp: MessageSquareText, email: Mail, app: Smartphone, web: Globe }
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function actionBadge(i: Item): { tone: Tone; label: string } {
  if (i.status === 'pending') return i.awaiting === 'admin' ? { tone: 'amber', label: 'Needs approval' } : { tone: 'blue', label: 'Waiting for the customer to confirm' }
  if (i.status === 'done') {
    if (i.autoApplied) return { tone: 'green', label: 'Applied automatically' }
    if (i.decidedBy) return { tone: 'green', label: `Approved by ${i.decidedBy}` }
    return { tone: 'green', label: i.awaiting === 'customer' ? 'Confirmed by the customer' : 'Done' }
  }
  if (i.status === 'confirmed') return { tone: 'blue', label: 'Running' }
  if (i.status === 'declined') return i.decidedBy ? { tone: 'muted', label: `Rejected by ${i.decidedBy}` } : { tone: 'muted', label: 'Customer said no' }
  if (i.status === 'failed') return { tone: 'red', label: 'Could not be applied' }
  return { tone: 'muted', label: i.status ?? '' }
}

export default function RecordReplies({ entityType, entityId, canWrite }: { entityType: string; entityId: string; canWrite: boolean }) {
  const toast = useActionToast()
  const [data, setData] = useState<{ items: Item[]; sessionIds: string[]; pending: number } | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/replies?entityType=${entityType}&entityId=${entityId}`, { credentials: 'include' }).catch(() => null)
    if (res?.ok) setData(await res.json())
  }, [entityType, entityId])

  useEffect(() => {
    load()
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  const decide = async (i: Item, decision: 'approve' | 'reject') => {
    setBusy(i.id)
    try {
      const res = await fetch(`/api/admin/replies/actions/${i.id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[i.id] || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Something went wrong')
      toast.success(decision === 'approve' ? (i.manual ? 'Marked as handled' : 'Approved and applied') : 'Rejected; the customer has been told')
      await load()
      if (decision === 'approve' && !i.manual) window.dispatchEvent(new Event('admin-agent:changed'))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (!data?.items.length) return null
  const sessionId = data.sessionIds[data.sessionIds.length - 1]

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Customer replies
          {data.pending > 0 && <span className={badgeCls('amber')}>{data.pending} to approve</span>}
        </span>
      }
      hint="Answers to what we asked, by WhatsApp or email. The assistant reads each one and acts on clear, low-risk answers."
      action={
        sessionId ? (
          <a href={ap(`/admin/support?s=${sessionId}`)} className="text-xs font-medium text-accent-600 hover:underline">
            Open conversation
          </a>
        ) : undefined
      }
    >
      <ol className="space-y-3">
        {data.items.map(i => {
          if (i.kind === 'asked') {
            return (
              <li key={i.id} className="flex items-center gap-2 text-xs text-foreground-muted">
                <span className="h-px flex-1 bg-border-default" />
                We asked: {i.scenario} · {when(i.at)}
                {i.status !== 'open' && <span className={badgeCls('muted')}>{i.status === 'answered' ? 'answered' : 'closed'}</span>}
                <span className="h-px flex-1 bg-border-default" />
              </li>
            )
          }
          if (i.kind === 'message') {
            const mine = i.sender !== 'customer'
            const Icon = CHANNEL_ICON[i.channel ?? 'web'] ?? Globe
            return (
              <li key={i.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-surface-secondary text-foreground-secondary' : 'border border-border-default bg-surface-elevated text-foreground'}`}>
                  <p className="whitespace-pre-wrap break-words">{i.text}</p>
                  {!!i.attachments?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {i.attachments.map(a => (
                        <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-border-default px-1.5 py-0.5 text-xs hover:bg-surface-secondary">
                          <Paperclip className="h-3 w-3" /> {a.name}
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-foreground-muted">
                    {mine ? <Bot className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                    {mine ? (i.sender === 'admin' ? 'Team' : 'Assistant') : 'Customer'} · {when(i.at)}
                  </p>
                </div>
              </li>
            )
          }
          const b = actionBadge(i)
          const waiting = i.status === 'pending' && i.awaiting === 'admin'
          return (
            <li key={i.id} className={`rounded-lg border p-3 ${waiting ? 'border-amber-500/40 bg-amber-500/5' : 'border-border-default'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{i.title}</span>
                <span className={badgeCls(b.tone)}>{b.label}</span>
              </div>
              {i.reading && (
                <p className="mt-1 text-xs text-foreground-muted">
                  Read as: {i.reading}
                  {i.confidence != null && ` · ${Math.round(i.confidence * 100)}% sure`}
                </p>
              )}
              {i.result && i.status !== 'pending' && <p className="mt-1 text-xs text-foreground-secondary">{i.result}</p>}
              {waiting && canWrite && (
                <div className="mt-2.5 space-y-2">
                  <input
                    value={notes[i.id] ?? ''}
                    onChange={e => setNotes(n => ({ ...n, [i.id]: e.target.value }))}
                    placeholder={i.manual ? 'What you did, for the customer (optional)' : 'Note to the customer (optional)'}
                    className={`${fieldInputCls} w-full`}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy === i.id}
                      onClick={() => decide(i, 'reject')}
                      className="control-sm inline-flex items-center gap-1 border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                    <button
                      type="button"
                      disabled={busy === i.id}
                      onClick={() => decide(i, 'approve')}
                      className="control-sm inline-flex items-center gap-1 bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> {i.manual ? 'Mark handled' : 'Approve'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
