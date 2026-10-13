'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Plus, Search, X } from 'lucide-react'
import TemplateEditor, { toEditorTemplate, type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'
import PhonePreview from '@/components/admin/messaging-templates/PhonePreview'
import { useToast } from '@/contexts/ToastContext'

// Jeffi's controls over one customer's Messaging API templates: which standard templates they get,
// whether they may edit, review of their changes, and editing their templates for them.

interface Settings { standard_templates: 'all' | 'selected'; allowed: Array<{ channel: string; slug: string }>; editing_enabled: boolean; review_required: boolean }
interface Item { id: string; slug: string; name: string; channel: Channel; category?: string | null; source: 'tenant' | 'platform'; review_status?: string | null; review_note?: string | null }
interface ReviewRow { id: string; channel: Channel; slug: string; name: string; review_status: string; review_note: string | null; proposed_version: number; proposed_subject: string | null; proposed_body: string; live_version: number | null; live_subject: string | null; live_body: string | null }

const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp']
const LABEL: Record<Channel, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }
const card = 'rounded-xl border border-border-default bg-surface-elevated p-5'
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50'
const tabCls = (on: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${on ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
        className={`mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-green-600' : 'bg-border-default'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span><span className="block text-sm font-medium text-foreground">{label}</span><span className="block text-xs text-foreground-muted">{hint}</span></span>
    </label>
  )
}

const htmlDoc = (body: string) => `<!doctype html><meta charset="utf-8"><body style="margin:12px;font:14px system-ui">${body}</body>`

export default function MessagingTab({ tenantId }: { tenantId: string }) {
  const base = `/api/admin/ecom/customers/${tenantId}/messaging`
  const { showToast } = useToast()
  const [section, setSection] = useState<'settings' | 'review' | 'templates'>('settings')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [catalog, setCatalog] = useState<Record<Channel, Item[]> | null>(null)
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const loadReviews = useCallback(() => fetch(`${base}/v2/templates/review`).then(r => r.json()).then(d => setReviews(d.items ?? [])).catch(() => setReviews([])), [base])
  const loadCatalog = useCallback(() => Promise.all(CHANNELS.map(c => fetch(`${base}/v2/templates?channel=${c}`).then(r => r.json()).then(d => d.items ?? []).catch(() => [])))
    .then(([email, sms, whatsapp]) => setCatalog({ email, sms, whatsapp })), [base])

  useEffect(() => {
    fetch(`${base}/v2/settings`).then(r => r.json()).then(s => { setSettings(s); setSaved(JSON.stringify(s)) }).catch(() => {})
    loadCatalog(); loadReviews()
  }, [base, loadCatalog, loadReviews])

  async function saveSettings() {
    if (!settings) return
    setBusy(true)
    const r = await fetch(`${base}/v2/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return showToast(d.message || 'Could not save', 'error')
    setSettings(d); setSaved(JSON.stringify(d)); showToast('Messaging settings saved', 'success')
  }

  async function decide(row: ReviewRow, decision: 'approved' | 'rejected', note?: string) {
    const r = await fetch(`${base}/v2/templates/${row.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, note }) })
    if (!r.ok) return showToast('Could not save the decision', 'error')
    showToast(decision === 'approved' ? 'Approved — the customer can send it now' : 'Rejected — the customer sees your note', 'success')
    loadReviews(); loadCatalog()
  }

  const pending = (reviews ?? []).filter(r => r.review_status === 'pending').length
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg bg-surface-secondary p-1">
        <button className={tabCls(section === 'settings')} onClick={() => setSection('settings')}>Settings</button>
        <button className={tabCls(section === 'review')} onClick={() => setSection('review')}>Review{pending > 0 && <span className="ml-1.5 rounded-full bg-yellow-500 px-1.5 text-[10px] font-bold text-white">{pending}</span>}</button>
        <button className={tabCls(section === 'templates')} onClick={() => setSection('templates')}>Templates</button>
      </div>

      {section === 'settings' && (!settings || !catalog ? <div className={card}><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div> : (
        <SettingsPanel settings={settings} setSettings={setSettings} catalog={catalog} dirty={saved !== JSON.stringify(settings)} busy={busy} onSave={saveSettings} />
      ))}

      {section === 'review' && (reviews === null ? <div className={card}><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div> : reviews.length === 0 ? (
        <div className={card}><p className="text-sm text-foreground-muted">Nothing waiting for review. {settings?.review_required ? '' : 'Review is off for this customer — their changes go live as they save.'}</p></div>
      ) : (
        <div className="space-y-4">{reviews.map(r => <ReviewCard key={r.id} row={r} onDecide={decide} />)}</div>
      ))}

      {section === 'templates' && <TemplatesPanel base={base} onChanged={() => { loadCatalog(); loadReviews() }} />}
    </div>
  )
}

function SettingsPanel({ settings, setSettings, catalog, dirty, busy, onSave }: {
  settings: Settings; setSettings: (s: Settings) => void; catalog: Record<Channel, Item[]>; dirty: boolean; busy: boolean; onSave: () => void
}) {
  const [channel, setChannel] = useState<Channel>('email')
  const [q, setQ] = useState('')
  const standard = catalog[channel].filter(i => i.source === 'platform' || i.source === 'tenant')
  const slugs = useMemo(() => [...new Map(standard.map(i => [i.slug, i])).values()], [standard])
  const shown = slugs.filter(i => `${i.name} ${i.slug}`.toLowerCase().includes(q.toLowerCase()))
  const isOn = (slug: string) => settings.allowed.some(a => a.channel === channel && a.slug === slug)
  const toggle = (slug: string) => setSettings({ ...settings, allowed: isOn(slug) ? settings.allowed.filter(a => !(a.channel === channel && a.slug === slug)) : [...settings.allowed, { channel, slug }] })
  const setAll = (on: boolean) => {
    const others = settings.allowed.filter(a => a.channel !== channel)
    setSettings({ ...settings, allowed: on ? [...others, ...shown.map(i => ({ channel, slug: i.slug }))] : others.concat(settings.allowed.filter(a => a.channel === channel && !shown.some(i => i.slug === a.slug))) })
  }
  const count = (c: Channel) => settings.allowed.filter(a => a.channel === c).length

  return (
    <div className="space-y-6">
      <div className={`${card} space-y-4`}>
        <h3 className="font-semibold text-foreground">Customer access</h3>
        <Toggle on={settings.editing_enabled} onChange={v => setSettings({ ...settings, editing_enabled: v })}
          label="Customer can create and edit templates" hint="Off: their console is read-only and API template writes are refused. You can still edit for them under Templates." />
        <Toggle on={settings.review_required} onChange={v => setSettings({ ...settings, review_required: v })}
          label="Review customer changes before they are sent" hint="Their edits wait in Review; sends keep using the last approved version until you approve." />
      </div>

      <div className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-foreground">Standard templates</h3>
          <div className="inline-flex rounded-lg bg-surface-secondary p-1">
            {(['all', 'selected'] as const).map(m => <button key={m} className={tabCls(settings.standard_templates === m)} onClick={() => setSettings({ ...settings, standard_templates: m })}>{m === 'all' ? 'All' : 'Only selected'}</button>)}
          </div>
        </div>
        {settings.standard_templates === 'all' ? (
          <p className="text-sm text-foreground-muted">The customer sees and can send every standard template.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-foreground-muted">Only ticked templates are visible and sendable. Their own templates are not affected.</p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {CHANNELS.map(c => <button key={c} className={tabCls(channel === c)} onClick={() => setChannel(c)}>{LABEL[c]} <span className="text-xs text-foreground-muted">{count(c)}</span></button>)}
              <div className="ml-auto flex items-center gap-2 rounded-lg border border-border-default px-2"><Search className="w-4 h-4 text-foreground-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="h-8 w-40 bg-transparent text-sm outline-none" /></div>
              <button className={`${btn} border border-border-default`} onClick={() => setAll(true)}>Tick all shown</button>
              <button className={`${btn} border border-border-default`} onClick={() => setAll(false)}>Clear shown</button>
            </div>
            <div className="grid max-h-[420px] grid-cols-1 gap-x-6 overflow-y-auto sm:grid-cols-2">
              {shown.map(i => (
                <label key={i.slug} className="flex cursor-pointer items-center gap-2 border-b border-border-default py-2 text-sm">
                  <input type="checkbox" checked={isOn(i.slug)} onChange={() => toggle(i.slug)} className="h-4 w-4 accent-green-600" />
                  <span className="truncate">{i.name || i.slug}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-foreground-muted">{i.slug}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button disabled={!dirty || busy} onClick={onSave} className={`${btn} bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Save settings</button>
      </div>
    </div>
  )
}

function Version({ title, channel, subject, body }: { title: string; channel: Channel; subject: string | null; body: string | null }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{title}</div>
      {body == null ? <p className="text-sm text-foreground-muted">No approved version yet — the customer can't send this template until you approve.</p>
        : channel === 'email' ? (
          <div className="overflow-hidden rounded-lg border border-border-default">
            {subject && <div className="border-b border-border-default px-3 py-2 text-sm"><span className="text-foreground-muted">Subject: </span>{subject}</div>}
            <iframe title={title} sandbox="" srcDoc={htmlDoc(body)} className="h-72 w-full bg-white" />
          </div>
        ) : <div className="origin-top scale-90"><PhonePreview channel={channel} body={body} /></div>}
    </div>
  )
}

function ReviewCard({ row, onDecide }: { row: ReviewRow; onDecide: (r: ReviewRow, d: 'approved' | 'rejected', note?: string) => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-semibold text-foreground">{row.name}</span>
        <span className="font-mono text-xs text-foreground-muted">{row.slug}</span>
        <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs">{LABEL[row.channel]}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.review_status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{row.review_status === 'pending' ? 'Waiting for review' : `Rejected${row.review_note ? ` — ${row.review_note}` : ''}`}</span>
        {row.review_status === 'pending' && (
          <div className="ml-auto flex gap-2">
            <button className={`${btn} bg-green-600 text-white hover:bg-green-700`} onClick={() => onDecide(row, 'approved')}><Check className="w-3.5 h-3.5" /> Approve</button>
            <button className={`${btn} border border-red-300 text-red-600`} onClick={() => setRejecting(v => !v)}><X className="w-3.5 h-3.5" /> Reject</button>
          </div>
        )}
      </div>
      {rejecting && (
        <div className="mb-4 flex gap-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="What should they change? (shown to the customer)" className="h-9 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm" />
          <button disabled={!note.trim()} className={`${btn} bg-red-600 text-white`} onClick={() => onDecide(row, 'rejected', note)}>Send</button>
        </div>
      )}
      <div className="flex flex-col gap-4 lg:flex-row">
        <Version title={`Live${row.live_version ? ` · v${row.live_version}` : ''}`} channel={row.channel} subject={row.live_subject} body={row.live_body} />
        <Version title={`Proposed · v${row.proposed_version}`} channel={row.channel} subject={row.proposed_subject} body={row.proposed_body} />
      </div>
    </div>
  )
}

function TemplatesPanel({ base, onChanged }: { base: string; onChanged: () => void }) {
  const { showToast } = useToast()
  const [channel, setChannel] = useState<Channel>('email')
  const [items, setItems] = useState<Item[] | null>(null)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const load = useCallback(() => { setItems(null); fetch(`${base}/v2/templates?channel=${channel}`).then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => setItems([])) }, [base, channel])
  useEffect(() => { load() }, [load])

  async function open(i: Item) {
    const r = await fetch(`${base}/v2/templates/${i.channel}/${encodeURIComponent(i.slug)}`)
    if (r.ok) setSelected(toEditorTemplate(await r.json())); else showToast('Could not open that template', 'error')
  }
  async function save(publish: boolean): Promise<EditorTemplate | null> {
    if (!selected) return null
    setSaving(true)
    try {
      const r = await fetch(selected.id ? `${base}/v2/templates/${selected.id}` : `${base}/v2/templates`, { method: selected.id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...selected, publish }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { showToast(`Save failed: ${d.message || d.error || r.status}`, 'error'); return null }
      const t = toEditorTemplate(d)
      setSelected(t); load(); onChanged(); showToast('Saved for the customer (approved).', 'success')
      return t
    } finally { setSaving(false) }
  }
  async function archive() {
    if (!selected?.slug) return
    const r = await fetch(`${base}/v2/templates/${selected.channel}/${encodeURIComponent(selected.slug)}`, { method: 'DELETE' })
    if (!r.ok) return showToast('Only the customer’s own copies can be archived', 'error')
    setSelected(null); load(); onChanged(); showToast('Archived — the standard template applies again', 'success')
  }

  const shown = (items ?? []).filter(i => `${i.name} ${i.slug}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className={`${card} p-0`}>
        <div className="flex gap-1 border-b border-border-default p-2">{CHANNELS.map(c => <button key={c} className={tabCls(channel === c)} onClick={() => { setChannel(c); setSelected(null) }}>{LABEL[c]}</button>)}</div>
        <div className="flex items-center gap-2 border-b border-border-default p-2">
          <Search className="ml-1 w-4 h-4 text-foreground-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="h-8 flex-1 bg-transparent text-sm outline-none" />
          <button title="New template" className={`${btn} bg-green-600 text-white`} onClick={() => setSelected({ slug: '', channel, name: '', subject: '', body: '', blocks_format: channel === 'email' ? 'tiptap' : channel === 'sms' ? 'sms-text' : 'wa-content' })}><Plus className="w-3.5 h-3.5" /></button>
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          {items === null ? <p className="p-4 text-xs text-foreground-muted">Loading…</p> : shown.map(i => (
            <button key={`${i.source}-${i.slug}`} onClick={() => open(i)} className="flex w-full items-center gap-2 border-b border-border-default px-3 py-2 text-left text-sm hover:bg-surface-secondary">
              <span className="truncate">{i.name || i.slug}</span>
              <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${i.source === 'tenant' ? 'bg-sky-100 text-sky-700' : 'bg-surface-secondary text-foreground-muted'}`}>{i.source === 'tenant' ? 'Customer' : 'Standard'}</span>
              {i.review_status && i.review_status !== 'approved' && <span className="shrink-0 rounded-full bg-yellow-100 px-1.5 text-[10px] font-semibold text-yellow-700">{i.review_status}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className={card}>
        {!selected ? <p className="py-16 text-center text-sm text-foreground-muted">Pick a template to view or edit it for the customer. Saving a standard template creates the customer's own copy.</p> : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {!selected.id ? (
                <input value={selected.slug} onChange={e => setSelected({ ...selected, slug: e.target.value })} placeholder="slug, e.g. order/confirmed" className="h-9 w-72 rounded-lg border border-border-default bg-surface px-3 text-sm" />
              ) : <span className="font-mono text-xs text-foreground-muted">{selected.slug}</span>}
              {selected.id && <button className={`${btn} ml-auto border border-border-default`} onClick={archive}>Archive customer copy</button>}
            </div>
            <TemplateEditor value={selected} apiBase={`${base}/v2/templates`} onChange={setSelected} onSave={save} saving={saving} />
          </>
        )}
      </div>
    </div>
  )
}
