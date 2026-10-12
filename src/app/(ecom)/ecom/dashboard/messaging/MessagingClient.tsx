'use client'

import { useEffect, useState } from 'react'
import { Card } from '../_components/Card'
import { STATUS_PILL, fmt, fmtDate } from '../_components/finance'

interface Tpl { id: string; slug: string; channel: string; name: string; subject: string | null; body: string; variables: string[]; system: boolean }
interface Msg { id: string; channel: string; to: string; template: string | null; status: string; price_inr: number; charged_inr: number; error: string | null; created_at: string }
const TONE: Record<string, string> = { sent: STATUS_PILL.captured, delivered: STATUS_PILL.settled, failed: STATUS_PILL.failed, skipped: STATUS_PILL.split, queued: 'org-sand' }

export default function MessagingClient() {
  const [tab, setTab] = useState<'log' | 'templates'>('log')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [tpls, setTpls] = useState<Tpl[]>([])
  const [edit, setEdit] = useState<Partial<Tpl> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const loadMsgs = () => fetch('/api/ecom/svc/messaging/messages?limit=100').then(r => r.json()).then(d => setMsgs(d.items ?? []))
  const loadTpls = () => fetch('/api/ecom/svc/messaging/templates').then(r => r.json()).then(d => setTpls(d.items ?? []))
  useEffect(() => { loadMsgs(); loadTpls() }, [])

  async function save() {
    setErr(null)
    const r = await fetch('/api/ecom/svc/messaging/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: edit?.slug, channel: edit?.channel ?? 'email', name: edit?.name, subject: edit?.subject || undefined, body: edit?.body }) })
    const d = await r.json()
    if (!r.ok) return setErr(d.message ?? d.error)
    setEdit(null); loadTpls()
  }
  async function archive(t: Tpl) { await fetch(`/api/ecom/svc/messaging/templates/${t.channel}/${t.slug}`, { method: 'DELETE' }); loadTpls() }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">{(['log', 'templates'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'ecom-accent-bg text-white' : 'org-sand org-sand-hover'}`}>{t === 'log' ? 'Message log' : 'Templates'}</button>)}</div>

      {tab === 'log' && (
        <Card>
          {msgs.length === 0 ? <p className="text-sm text-foreground-secondary">No messages yet. Send one with your API key and it shows up here.</p> : (
            <div className="-m-6 overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="org-sand text-foreground-secondary"><tr>{['When', 'Channel', 'To', 'Template', 'Status', 'Charged'].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border-default">{msgs.map(m => <tr key={m.id}><td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(m.created_at)}</td><td className="px-6 py-2.5 capitalize">{m.channel}</td><td className="px-6 py-2.5 font-mono text-xs">{m.to}</td><td className="px-6 py-2.5 text-xs">{m.template ?? '—'}</td><td className="px-6 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[m.status] ?? 'org-sand'}`} title={m.error ?? ''}>{m.status}</span></td><td className="px-6 py-2.5 tabular-nums">{fmt(m.charged_inr)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}

      {tab === 'templates' && (
        <>
          {edit ? (
            <Card title={edit.id ? 'Edit template' : 'New template'}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block"><span className="text-xs text-foreground-muted">Slug</span><input value={edit.slug ?? ''} onChange={e => setEdit({ ...edit, slug: e.target.value })} className="mt-1 w-full rounded-xl bg-surface-elevated px-3 py-2 text-sm" placeholder="welcome-v2" /></label>
                <label className="block"><span className="text-xs text-foreground-muted">Channel</span><select value={edit.channel ?? 'email'} onChange={e => setEdit({ ...edit, channel: e.target.value })} className="mt-1 w-full rounded-xl bg-surface-elevated px-3 py-2 text-sm"><option>email</option><option>sms</option><option>whatsapp</option></select></label>
                <label className="block"><span className="text-xs text-foreground-muted">Name</span><input value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} className="mt-1 w-full rounded-xl bg-surface-elevated px-3 py-2 text-sm" /></label>
                {(edit.channel ?? 'email') === 'email' && <label className="block sm:col-span-3"><span className="text-xs text-foreground-muted">Subject</span><input value={edit.subject ?? ''} onChange={e => setEdit({ ...edit, subject: e.target.value })} className="mt-1 w-full rounded-xl bg-surface-elevated px-3 py-2 text-sm" /></label>}
                <label className="block sm:col-span-3"><span className="text-xs text-foreground-muted">Body — use {'{{variable}}'} tokens</span><textarea rows={6} value={edit.body ?? ''} onChange={e => setEdit({ ...edit, body: e.target.value })} className="mt-1 w-full rounded-xl bg-surface-elevated px-3 py-2 text-sm font-mono" /></label>
              </div>
              {err && <p className="mt-3 text-sm text-[#8a2e1f]">{err}</p>}
              <div className="mt-4 flex gap-2"><button onClick={save} className="ecom-accent-bg rounded-full px-5 py-2 text-sm font-semibold text-white">Save</button><button onClick={() => setEdit(null)} className="org-sand rounded-full px-5 py-2 text-sm font-semibold">Cancel</button></div>
            </Card>
          ) : <button onClick={() => setEdit({ channel: 'email' })} className="ecom-accent-bg rounded-full px-5 py-2 text-sm font-semibold text-white">New template</button>}
          <Card title="Templates">
            <ul className="divide-y divide-border-default -mx-6">{tpls.map(t => <li key={t.id} className="flex items-center justify-between gap-4 px-6 py-3"><div className="min-w-0"><p className="text-sm font-medium"><span className="font-mono">{t.slug}</span> <span className="ml-2 rounded-full org-sand px-2 py-0.5 text-[10px] font-semibold">{t.channel}</span>{t.system && <span className="ml-1 rounded-full org-sage org-sage-text px-2 py-0.5 text-[10px] font-semibold">system</span>}</p><p className="text-xs text-foreground-secondary truncate">{t.name} · vars: {t.variables.join(', ') || '—'}</p></div>{!t.system && <div className="flex gap-3 shrink-0 text-xs"><button onClick={() => setEdit(t)} className="org-brown font-semibold hover:underline">Edit</button><button onClick={() => archive(t)} className="text-[#8a2e1f] hover:underline">Archive</button></div>}</li>)}</ul>
          </Card>
        </>
      )}
    </div>
  )
}
