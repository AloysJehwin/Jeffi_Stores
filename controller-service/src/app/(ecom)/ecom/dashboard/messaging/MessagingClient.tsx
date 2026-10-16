'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mail, MessageSquare, MessageCircle, Play, Plus, Search } from 'lucide-react'
import { Card } from '../_components/Card'
import { SkeletonRows } from '../_components/Skeleton'
import Pager, { useCursorPages } from '../_components/Pager'
import { STATUS_PILL, fmt, fmtDate } from '../_components/finance'
import { useToast } from '@/contexts/ToastContext'
import BulkMessages from './BulkMessages'
import TemplateEditor, { toEditorTemplate, type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'
import { ECOM_ENRICH_ENDPOINT } from '@/components/admin/AIEnrichButton'
import PlayDialog, { PlayButton, type PlayTarget } from '../_components/PlayDialog'
import { Segmented, currentRowCls, fieldCls, focusRing } from '../../_ui'

interface ListItem { id: string; slug: string; channel: Channel; name: string; category?: string | null; approval_status?: string | null; source?: 'tenant' | 'platform'; review_status?: string | null }
interface Msg { id: string; channel: string; to: string; template: string | null; status: string; price_inr: number; charged_inr: number; error: string | null; created_at: string }
const TONE: Record<string, string> = { sent: STATUS_PILL.captured, delivered: STATUS_PILL.settled, failed: STATUS_PILL.failed, skipped: STATUS_PILL.split, queued: 'org-sand' }
const CHANNELS: Array<{ key: Channel; label: string; icon: typeof Mail }> = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
]
const API = '/api/ecom/svc/messaging'
const WA_TONE: Record<string, string> = { approved: 'org-sage org-sage-text', rejected: 'bg-[#f6d5cc] text-[#8a2e1f]' }

export default function MessagingClient(props: { prices: Record<string, number>; balance: number }) {
  const [tab, setTab] = useState<'log' | 'templates' | 'bulk'>('log')
  const { showToast } = useToast()
  const [channel, setChannel] = useState<Channel>('email')
  const { items: msgs, page: logPage, hasNext: logNext, go: logGo } = useCursorPages<Msg>(`${API}/messages`)
  const [items, setItems] = useState<ListItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Jeffi's controls for this workspace (null = none) and the open template's review state.
  const [gov, setGov] = useState<{ editing_enabled: boolean; review_required: boolean } | null>(null)
  const [review, setReview] = useState<{ status: string; note: string | null } | null>(null)
  const canEdit = gov?.editing_enabled !== false
  const [play, setPlay] = useState<PlayTarget | null>(null)

  const loadTpls = useCallback(() => {
    setItems(null)
    return fetch(`${API}/v2/templates?channel=${channel}`).then(r => r.json()).then(d => { setItems(d.items ?? []); setGov(d.settings ?? null) }).catch(() => setItems([]))
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

  // Tab, channel and the open template live in the URL (?tab=&channel=&template=) so links and Back work.
  const ready = useRef(false)
  const fromUrl = useCallback(() => {
    const p = new URLSearchParams(location.search)
    const t = p.get('tab'), c = p.get('channel') as Channel | null, slug = p.get('template')
    const ch = c && CHANNELS.some(x => x.key === c) ? c : 'email'
    setTab(t === 'templates' || t === 'bulk' ? t : 'log')
    setChannel(ch)
    if (t === 'templates' && slug) void open({ slug, channel: ch } as ListItem)
    else setSelected(null)
    // Start writing the URL only after this state has rendered.
    setTimeout(() => { ready.current = true }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    fromUrl()
    window.addEventListener('popstate', fromUrl)
    return () => window.removeEventListener('popstate', fromUrl)
  }, [fromUrl])
  const slugInUrl = selected?.slug || opening
  useEffect(() => {
    if (!ready.current) return
    const p = new URLSearchParams()
    if (tab !== 'log') p.set('tab', tab)
    if (tab === 'templates') {
      p.set('channel', channel)
      if (slugInUrl) p.set('template', slugInUrl)
    }
    const url = `${location.pathname}${p.size ? `?${p}` : ''}`
    if (url !== `${location.pathname}${location.search}`) history.pushState(null, '', url)
  }, [tab, channel, slugInUrl])

  async function open(it: ListItem) {
    setOpening(it.slug)
    try {
      const r = await fetch(`${API}/v2/templates/${it.channel}/${encodeURIComponent(it.slug)}`)
      if (r.ok) {
        const d = await r.json()
        setSelected(toEditorTemplate(d))
        setReview(d.review_status ? { status: d.review_status, note: d.review_note ?? null } : null)
      } else showToast('Could not open that template.', 'error')
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
      const raw = await r.json()
      const saved = toEditorTemplate(raw)
      setReview(raw.review_status ? { status: raw.review_status, note: raw.review_note ?? null } : null)
      if (raw.review_status === 'pending') showToast('Saved — Jeffi will review it; sends keep using the approved version until then.', 'success')
      setSelected(saved); await loadTpls(); showToast(publish ? 'Template published.' : 'Draft saved.', 'success')
      return saved
    } finally { setSaving(false) }
  }

  const customised = (items ?? []).filter(i => i.source === 'tenant').length

  return (
    <div className="space-y-6">
      <Segmented ariaLabel="Messaging sections" value={tab} onChange={setTab}
        options={[{ value: 'log', label: 'Message log' }, { value: 'templates', label: 'Templates' }, { value: 'bulk', label: 'Bulk' }]} />

      {tab === 'bulk' && <BulkMessages {...props} />}

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
            <Segmented<Channel> ariaLabel="Channel" value={channel} onChange={k => { setChannel(k); setSelected(null); setQuery('') }}
              options={CHANNELS.map(c => ({ value: c.key, label: c.label, icon: c.icon, count: channel === c.key && items ? items.length : undefined }))} />
            {items && items.length > 0 && (
              <span className="text-xs text-foreground-muted">{customised} customised · {items.length - customised} standard</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6 items-start">
            <aside className="rounded-2xl border border-border-default bg-surface-elevated overflow-hidden md:sticky md:top-6">
              <div className="flex items-center gap-2 p-3 border-b border-border-default">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter templates" className={`w-full bg-surface pl-9 pr-3 py-2 text-sm text-foreground ${fieldCls}`} />
                </div>
                {canEdit && <button onClick={createNew} title="New template" aria-label="New template" className={`ecom-accent-bg rounded-full p-2 text-white shrink-0 ${focusRing}`}><Plus className="w-4 h-4" /></button>}
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
                              aria-current={active || undefined}
                              className={`rounded-none w-full text-left px-4 py-3 border-b border-b-border-default transition-colors ${focusRing} ${active ? currentRowCls : 'ecom-hover'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium truncate">{it.name || it.slug}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <PlayButton className="-my-1" onClick={() => setPlay({ kind: 'message', channel: it.channel, slug: it.slug, name: it.name })} />
                                  {opening === it.slug
                                    ? <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[var(--org-terracotta)] border-t-transparent animate-spin" />
                                    : <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.source === 'tenant' ? 'org-peach org-brown' : 'org-sand text-foreground-muted'}`}>{it.source === 'tenant' ? 'Customised' : 'Standard'}</span>}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted">
                                <code className="truncate">{it.slug}</code>
                                {it.source === 'tenant' && it.review_status && it.review_status !== 'approved' && (
                                  <span className={`rounded-full px-1.5 text-[10px] font-medium ${it.review_status === 'rejected' ? 'bg-[#f6d5cc] text-[#8a2e1f]' : 'org-peach org-brown'}`}>{it.review_status === 'pending' ? 'in review' : 'changes rejected'}</span>
                                )}
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
              {selected && !canEdit && (
                <p className="mb-4 rounded-xl org-sand px-4 py-3 text-sm">Templates for this workspace are managed by Jeffi. You can preview and send them; to change one, write to support@jeffistores.in.</p>
              )}
              {selected && canEdit && review?.status === 'pending' && (
                <p className="mb-4 rounded-xl org-peach px-4 py-3 text-sm"><strong>In review.</strong> Jeffi is reviewing your latest changes — messages keep using the last approved version until then.</p>
              )}
              {selected && canEdit && review?.status === 'rejected' && (
                <p className="mb-4 rounded-xl bg-[#f6d5cc]/60 px-4 py-3 text-sm text-[#8a2e1f]"><strong>Changes not approved.</strong> {review.note ?? ''} Edit and save again to resubmit.</p>
              )}
              {selected && (
                <Card>
                  {selected.id && (
                    <div className="-mt-2 mb-3 flex items-center justify-end">
                      <button type="button" onClick={() => setPlay({ kind: 'message', channel: selected.channel, slug: selected.slug, name: selected.name })}
                        title="Test live" aria-label="Test live" className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-xs font-semibold hover:bg-surface-secondary">
                        <Play className="w-3.5 h-3.5" /> Test live
                      </button>
                    </div>
                  )}
                  <fieldset disabled={!canEdit} className="min-w-0">
                  {!selected.id && (
                    <label className="block mb-4">
                      <span className="text-xs text-foreground-muted">Slug (e.g. order/confirmed)</span>
                      <input className={`mt-1 w-full bg-surface px-3 py-2 text-sm ${fieldCls}`} value={selected.slug} onChange={e => setSelected({ ...selected, slug: e.target.value })} />
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
                    aiEndpoint={ECOM_ENRICH_ENDPOINT}
                  />
                  </fieldset>
                </Card>
              )}
            </section>
          </div>
        </>
      )}
      {play && <PlayDialog target={play} prices={props.prices} onClose={() => setPlay(null)} />}
    </div>
  )
}
