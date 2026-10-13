'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '../_components/Card'
import { STATUS_PILL, fmt, fmtDate } from '../_components/finance'
import TemplateEditor, { type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'

interface ListItem { id: string; slug: string; channel: Channel; name: string; category?: string | null; approval_status?: string | null }
interface Msg { id: string; channel: string; to: string; template: string | null; status: string; price_inr: number; charged_inr: number; error: string | null; created_at: string }
const TONE: Record<string, string> = { sent: STATUS_PILL.captured, delivered: STATUS_PILL.settled, failed: STATUS_PILL.failed, skipped: STATUS_PILL.split, queued: 'org-sand' }
const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp']
const API = '/api/ecom/svc/messaging'

export default function MessagingClient() {
  const [tab, setTab] = useState<'log' | 'templates'>('log')
  const [channel, setChannel] = useState<Channel>('email')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [items, setItems] = useState<ListItem[]>([])
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  const loadMsgs = () => fetch(`${API}/messages?limit=100`).then(r => r.json()).then(d => setMsgs(d.items ?? []))
  const loadTpls = useCallback(() => fetch(`${API}/templates?channel=${channel}`).then(r => r.json()).then(d => setItems(d.items ?? [])), [channel])

  useEffect(() => { loadMsgs() }, [])
  useEffect(() => { if (tab === 'templates') loadTpls() }, [tab, loadTpls])

  async function open(it: ListItem) {
    const r = await fetch(`${API}/v2/templates/${it.channel}/${encodeURIComponent(it.slug)}`)
    if (r.ok) setSelected(await r.json())
  }

  function createNew() {
    setSelected({ slug: '', channel, name: '', subject: '', body: '', blocks_format: channel === 'email' ? 'tiptap' : channel === 'sms' ? 'sms-text' : 'wa-content' })
  }

  async function save(publish: boolean) {
    if (!selected) return
    setSaving(true)
    try {
      const url = selected.id ? `${API}/v2/templates/${selected.id}` : `${API}/v2/templates`
      const method = selected.id ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...selected, publish }) })
      if (r.ok) { setSelected(await r.json()); await loadTpls() } else alert('Save failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">{(['log', 'templates'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'ecom-accent-bg text-white' : 'org-sand org-sand-hover'}`}>{t === 'log' ? 'Message log' : 'Templates'}</button>)}</div>

      {tab === 'log' && (
        <Card>
          {msgs.length === 0 ? <p className="text-sm text-foreground-secondary">No messages yet.</p> : (
            <div className="-m-6 overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="org-sand text-foreground-secondary"><tr>{['When', 'Channel', 'To', 'Template', 'Status', 'Charged'].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border-default">{msgs.map(m => <tr key={m.id}><td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(m.created_at)}</td><td className="px-6 py-2.5 capitalize">{m.channel}</td><td className="px-6 py-2.5 font-mono text-xs">{m.to}</td><td className="px-6 py-2.5 text-xs">{m.template ?? '—'}</td><td className="px-6 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[m.status] ?? 'org-sand'}`} title={m.error ?? ''}>{m.status}</span></td><td className="px-6 py-2.5 tabular-nums">{fmt(m.charged_inr)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}

      {tab === 'templates' && (
        <>
          <div className="flex gap-2 border-b">
            {CHANNELS.map(c => (
              <button key={c} onClick={() => { setChannel(c); setSelected(null) }} className={`px-4 py-2 border-b-2 ${channel === c ? 'border-black font-semibold' : 'border-transparent text-foreground-secondary'}`}>
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Templates</h3>
                <button onClick={createNew} className="ecom-accent-bg rounded-full px-3 py-1 text-xs font-semibold text-white">+ New</button>
              </div>
              {items.length === 0 ? <p className="text-sm text-foreground-secondary">No templates yet.</p> : (
                <ul className="divide-y divide-border-default -mx-6">
                  {items.map(it => (
                    <li key={it.id}>
                      <button onClick={() => open(it)} className={`w-full text-left px-6 py-2 hover:bg-surface-elevated ${selected?.id === it.id ? 'bg-surface-elevated' : ''}`}>
                        <div className="text-sm font-medium">{it.name || it.slug}</div>
                        <div className="text-xs text-foreground-secondary">{it.slug} · {it.category ?? '—'}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <section>
              {!selected && <Card><p className="text-sm text-foreground-secondary">Select a template on the left, or create a new one.</p></Card>}
              {selected && (
                <Card>
                  {!selected.id && (
                    <label className="block mb-4">
                      <span className="text-xs text-foreground-muted">Slug (e.g. order/confirmed)</span>
                      <input className="mt-1 w-full rounded-xl bg-surface-elevated px-3 py-2 text-sm" value={selected.slug} onChange={e => setSelected({ ...selected, slug: e.target.value })} />
                    </label>
                  )}
                  <TemplateEditor value={selected} apiBase={`${API}/v2/templates`} onChange={setSelected} onSave={save} saving={saving} />
                </Card>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
