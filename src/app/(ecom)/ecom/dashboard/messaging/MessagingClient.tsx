'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mail, MessageSquare, MessageCircle, Plus, Search } from 'lucide-react'
import { Card } from '../_components/Card'
import { SkeletonRows } from '../_components/Skeleton'
import Pager, { useCursorPages } from '../_components/Pager'
import { STATUS_PILL, fmt, fmtDate } from '../_components/finance'
import { useToast } from '@/contexts/ToastContext'
import TemplateEditor, { toEditorTemplate, type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'

interface ListItem { id: string; slug: string; channel: Channel; name: string; category?: string | null; approval_status?: string | null; source?: 'tenant' | 'platform' }
interface Msg { id: string; channel: string; to: string; template: string | null; status: string; price_inr: number; charged_inr: number; error: string | null; created_at: string }
const TONE: Record<string, string> = { sent: STATUS_PILL.captured, delivered: STATUS_PILL.settled, failed: STATUS_PILL.failed, skipped: STATUS_PILL.split, queued: 'org-sand' }
const CHANNELS: Array<{ key: Channel; label: string; icon: typeof Mail }> = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
]
const API = '/api/ecom/svc/messaging'
const WA_TONE: Record<string, string> = { approved: 'org-sage org-sage-text', rejected: 'bg-[#f6d5cc] text-[#8a2e1f]' }

export default function MessagingClient() {
  const [tab, setTab] = useState<'log' | 'templates'>('log')
  const { showToast } = useToast()
  const [channel, setChannel] = useState<Channel>('email')
  const { items: msgs, page: logPage, hasNext: logNext, go: logGo } = useCursorPages<Msg>(`${API}/messages`)
  const [items, setItems] = useState<ListItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadTpls = useCallback(() => {
    setItems(null)
    return fetch(`${API}/v2/templates?channel=${channel}`).then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => setItems([]))
  }, [channel])

  useEffect(() => { if (tab === 'templates') loadTpls() }, [tab, loadTpls])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (items ?? []).filter(i => !q || `${i.name} ${i.slug} ${i.category ?? ''}`.toLowerCase().includes(q))
    const map = new Map<string, ListItem[]>()
    for (const it of list) {
      const k = it.category || 'other'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(it)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug))] as const)
  }, [items, query])

  async function open(it: ListItem) {
    setOpening(it.slug)
    try {
      const r = await fetch(`${API}/v2/templates/${it.channel}/${encodeURIComponent(it.slug)}`)
      if (r.ok) setSelected(toEditorTemplate(await r.json()))
      else showToast('Could not open that template.', 'error')
    } finally { setOpening(null) }
  }

  function createNew() {
    setSelected({ slug: '', channel, name: '', subject: '', body: '', blocks_format: channel === 'email' ? 'tiptap' : channel === 'sms' ? 'sms-text' : 'wa-content' })
  }

  async function save(publish: boolean): Promise<EditorTemplate | null> {
    if (!selected) return null
    setSaving(true)
    try {
      const url = selected.id ? `${API}/v2/templates/${selected.id}` : `${API}/v2/templates`
      const r = await fetch(url, { method: selected.id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...selected, publish }) })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        showToast(`Save failed: ${err?.message || err?.error || r.status}`, 'error')
        return null
      }
      const saved = toEditorTemplate(await r.json())
      setSelected(saved); await loadTpls(); showToast(publish ? 'Template published.' : 'Draft saved.', 'success')
      return saved
    } finally { setSaving(false) }
  }

  const customised = (items ?? []).filter(i => i.source === 'tenant').length

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {(['log', 'templates'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === t ? 'ecom-accent-bg text-white' : 'org-sand org-sand-hover'}`}>
            {t === 'log' ? 'Message log' : 'Templates'}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div>
        <Card>
          {msgs === null ? <SkeletonRows rows={6} cols={5} /> : msgs.length === 0 ? <p className="text-sm text-foreground-secondary">No messages yet.</p> : (
            <div className="-m-6 overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="org-sand text-foreground-secondary"><tr>{['When', 'Channel', 'To', 'Template', 'Status', 'Charged'].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border-default">{msgs.map(m => <tr key={m.id}><td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(m.created_at)}</td><td className="px-6 py-2.5 capitalize">{m.channel}</td><td className="px-6 py-2.5 font-mono text-xs">{m.to}</td><td className="px-6 py-2.5 text-xs">{m.template ?? '—'}</td><td className="px-6 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[m.status] ?? 'org-sand'}`} title={m.error ?? ''}>{m.status}</span></td><td className="px-6 py-2.5 tabular-nums">{fmt(m.charged_inr)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Pager page={logPage} hasNext={logNext} onPage={logGo} />
        </div>
      )}

      {tab === 'templates' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" className="inline-flex rounded-full org-sand p-1">
              {CHANNELS.map(c => {
                const on = channel === c.key
                const Icon = c.icon
                return (
                  <button
                    key={c.key}
                    role="tab"
                    aria-selected={on}
                    onClick={() => { setChannel(c.key); setSelected(null); setQuery('') }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${on ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}
                  >
                    <Icon className={`w-4 h-4 ${on ? 'ecom-accent-text' : ''}`} />
                    {c.label}
                    {on && items && <span className="text-xs font-medium text-foreground-muted tabular-nums">{items.length}</span>}
                  </button>
                )
              })}
            </div>
            {items && items.length > 0 && (
              <span className="text-xs text-foreground-muted">{customised} customised · {items.length - customised} standard</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6 items-start">
            <aside className="rounded-2xl border border-border-default bg-surface-elevated overflow-hidden md:sticky md:top-6">
              <div className="flex items-center gap-2 p-3 border-b border-border-default">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter templates" className="w-full bg-surface pl-9 pr-3 py-2 text-sm text-foreground border border-border-default focus:outline-none focus:ring-2 focus:ring-accent-500" />
                </div>
                <button onClick={createNew} title="New template" className="ecom-accent-bg rounded-full p-2 text-white shrink-0"><Plus className="w-4 h-4" /></button>
              </div>
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto overscroll-contain">
                {items === null && Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="px-4 py-3 border-b border-border-default animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="h-3.5 w-2/3 bg-surface-secondary rounded mb-2" />
                    <div className="h-3 w-1/3 bg-surface-secondary rounded opacity-60" />
                  </div>
                ))}
                {items !== null && grouped.length === 0 && (
                  <div className="p-8 text-center">
                    <p className="text-sm font-medium">No templates match</p>
                    <p className="text-xs text-foreground-muted mt-1">{query ? 'Try a different filter.' : 'Create one with the + button.'}</p>
                  </div>
                )}
                {grouped.map(([cat, list]) => (
                  <div key={cat}>
                    <div className="sticky top-0 z-10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted org-chrome border-y border-border-default">{cat}</div>
                    <ul>
                      {list.map(it => {
                        const active = selected?.slug === it.slug && selected.channel === it.channel
                        return (
                          <li key={it.id}>
                            <button
                              onClick={() => open(it)}
                              className={`rounded-none w-full text-left px-4 py-3 border-l-[3px] border-b border-b-border-default transition-colors ${active ? 'border-l-[var(--org-terracotta)] org-peach' : 'border-l-transparent hover:bg-surface-secondary/50'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium truncate">{it.name || it.slug}</span>
                                {opening === it.slug
                                  ? <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[var(--org-terracotta)] border-t-transparent animate-spin" />
                                  : <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.source === 'tenant' ? 'org-peach org-brown' : 'org-sand text-foreground-muted'}`}>{it.source === 'tenant' ? 'Customised' : 'Standard'}</span>}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted">
                                <code className="truncate">{it.slug}</code>
                                {it.channel === 'whatsapp' && it.approval_status && (
                                  <span className={`rounded-full px-1.5 text-[10px] font-medium ${WA_TONE[it.approval_status] ?? 'org-sand'}`}>{it.approval_status}</span>
                                )}
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>

            <section>
              {!selected && !opening && (
                <Card>
                  <div className="py-12 text-center">
                    <p className="text-sm font-medium">Select a template to edit</p>
                    <p className="text-xs text-foreground-muted mt-1">Standard templates are shared by every store; saving creates your own copy.</p>
                  </div>
                </Card>
              )}
              {opening && !selected && <Card><SkeletonRows rows={6} cols={2} /></Card>}
              {selected && (
                <Card>
                  {!selected.id && (
                    <label className="block mb-4">
                      <span className="text-xs text-foreground-muted">Slug (e.g. order/confirmed)</span>
                      <input className="mt-1 w-full bg-surface px-3 py-2 text-sm border border-border-default" value={selected.slug} onChange={e => setSelected({ ...selected, slug: e.target.value })} />
                    </label>
                  )}
                  <TemplateEditor
                    value={selected}
                    apiBase={`${API}/v2/templates`}
                    assetsBase="/api/ecom/messaging/assets/upload"
                    shortLinksBase={`${API}/short-links`}
                    onChange={setSelected}
                    onSave={save}
                    saving={saving}
                  />
                </Card>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
