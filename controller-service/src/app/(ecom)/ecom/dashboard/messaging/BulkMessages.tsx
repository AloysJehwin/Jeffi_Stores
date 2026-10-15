'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { FileDown, FileUp, Loader2, Mail, MessageCircle, MessageSquare, Search, X } from 'lucide-react'
import { Card } from '../_components/Card'
import BulkJobs, { Pill, type BulkItem } from '../_components/BulkJobs'
import { fmt } from '../_components/finance'
import { useToast } from '@/contexts/ToastContext'
import AIEnrichButton, { ECOM_ENRICH_ENDPOINT } from '@/components/admin/AIEnrichButton'

type Channel = 'email' | 'sms' | 'whatsapp'
type Row = Record<string, string>
interface Tpl { slug: string; name: string; channel: Channel }

const API = '/api/ecom/svc/messaging'
const BASE = `${API}/messages/bulk`
const CHANNELS: Array<{ key: Channel; label: string; icon: typeof Mail }> = [
  { key: 'email', label: 'Email', icon: Mail }, { key: 'sms', label: 'SMS', icon: MessageSquare }, { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
]
const TOKEN = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g
// Filled by the API on every send.
const AUTO = new Set(['store_name', 'store_email', 'store_phone', 'store_web', 'current_year', 'date', 'customer_email'])
const RESERVED = new Set(['to', 'reference', 'media_url', 'button_url'])
const TO_ALIASES = ['to', 'email', 'phone', 'mobile']

export default function BulkMessages({ prices, balance }: { prices: Record<string, number>; balance: number }) {
  const { showToast } = useToast()
  const [channel, setChannel] = useState<Channel>('email')
  const [templates, setTemplates] = useState<Tpl[] | null>(null)
  const [query, setQuery] = useState('')
  const [tpl, setTpl] = useState<{ slug: string; name: string; tokens: string[] } | null>(null)
  const [file, setFile] = useState<{ name: string; rows: Row[]; headers: string[] } | null>(null)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTemplates(null); setTpl(null)
    fetch(`${API}/v2/templates?channel=${channel}`).then(r => r.json()).then(d => setTemplates(d.items ?? [])).catch(() => setTemplates([]))
  }, [channel])

  async function pickTemplate(t: Tpl) {
    const r = await fetch(`${API}/v2/templates/${channel}/${encodeURIComponent(t.slug)}`)
    if (!r.ok) return showToast('Could not open that template', 'error')
    const d = await r.json()
    const v = d.current_version ?? d
    const tokens = [...new Set([...`${v.subject ?? ''} ${v.body ?? ''}`.matchAll(TOKEN)].map(m => m[1]))].filter(k => !AUTO.has(k))
    setTpl({ slug: t.slug, name: t.name || t.slug, tokens })
  }

  function onFile(f: File | undefined) {
    if (!f) return
    Papa.parse<Row>(f, {
      header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim().replace(/\s+/g, '_'),
      complete: r => { setFile({ name: f.name, rows: r.data, headers: r.meta.fields ?? [] }); setReference(f.name.replace(/\.csv$/i, '')) },
      error: () => showToast('Could not read that CSV', 'error'),
    })
    if (input.current) input.current.value = ''
  }

  const parsed = useMemo(() => {
    if (!file) return null
    const toCol = file.headers.find(h => TO_ALIASES.includes(h.toLowerCase()))
    const varCols = file.headers.filter(h => h !== toCol && !RESERVED.has(h.toLowerCase()))
    const errors: string[] = []
    if (!toCol) errors.push('Add a "to" column (email address or phone number)')
    const recipients = toCol ? file.rows.map((r, i) => {
      const to = r[toCol]?.trim() ?? ''
      if (!to) errors.push(`Row ${i + 2}: "to" is empty`)
      else if (channel === 'email' ? !/^\S+@\S+\.\S+$/.test(to) : !/^\+?[\d\s-]{10,16}$/.test(to)) errors.push(`Row ${i + 2}: "${to}" is not a valid ${channel === 'email' ? 'email' : 'phone number'}`)
      const variables = Object.fromEntries(varCols.map(c => [c, r[c] ?? '']).filter(([, v]) => v !== ''))
      return { to, reference: r.reference || undefined, media_url: r.media_url || undefined, button_url: r.button_url || undefined, variables }
    }) : []
    const missing = (tpl?.tokens ?? []).filter(k => !varCols.includes(k))
    return { recipients, errors, varCols, missing }
  }, [file, channel, tpl])

  function sample() {
    const cols = ['to', ...(tpl?.tokens ?? ['first_name']), 'reference']
    const to = channel === 'email' ? 'customer@example.com' : '+919876543210'
    const csv = [cols.join(','), cols.map(c => (c === 'to' ? to : c === 'reference' ? 'cust-1' : `<${c}>`)).join(',')].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `bulk-${channel}-${tpl?.slug.replace(/\W+/g, '-') ?? 'sample'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function start() {
    if (!tpl || !parsed?.recipients.length) return
    setBusy(true)
    const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, template: tpl.slug, recipients: parsed.recipients, reference: reference || undefined }) })
    const body = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return showToast(body.message ?? 'Could not start the job', 'error')
    showToast(`Sending to ${body.total} recipients`, 'success')
    setFile(null)
    setRefresh(n => n + 1)
  }

  const cost = (parsed?.recipients.length ?? 0) * (prices[channel] ?? 0)
  const shown = (templates ?? []).filter(t => `${t.name} ${t.slug}`.toLowerCase().includes(query.toLowerCase()))

  const form = (
    <Card title="New bulk send">
      <div className="space-y-5">
        <div role="tablist" className="inline-flex rounded-full org-sand p-1">
          {CHANNELS.map(c => {
            const on = c.key === channel
            return (
              <button key={c.key} type="button" role="tab" aria-selected={on} onClick={() => { setChannel(c.key); setFile(null) }}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold ${on ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                <c.icon className={`w-4 h-4 ${on ? 'ecom-accent-text' : ''}`} /> {c.label}
              </button>
            )
          })}
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold">Template</div>
          {tpl ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-default px-3 py-2">
              <span className="text-sm font-medium">{tpl.name}</span><span className="font-mono text-xs text-foreground-muted">{tpl.slug}</span>
              <button type="button" onClick={() => { setTpl(null); setFile(null) }} className="ml-auto text-xs font-semibold org-brown">Change</button>
            </div>
          ) : (
            <div className="rounded-lg border border-border-default">
              <div className="flex items-center gap-2 border-b border-border-default px-3"><Search className="w-4 h-4 text-foreground-muted" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" className="h-9 w-full bg-transparent text-sm outline-none" />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {templates === null ? <p className="p-3 text-xs text-foreground-muted">Loading…</p> : shown.length === 0 ? <p className="p-3 text-xs text-foreground-muted">No templates.</p> : shown.map(t => (
                  <button key={t.slug} type="button" onClick={() => pickTemplate(t)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-secondary">
                    <span>{t.name || t.slug}</span><span className="ml-auto font-mono text-[11px] text-foreground-muted">{t.slug}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {tpl && (!file ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground-secondary">
              Upload a CSV with a <code>to</code> column and one column per variable{tpl.tokens.length ? <>: {tpl.tokens.map(t => <code key={t} className="mx-0.5">{t}</code>)}</> : ' (this template has none)'}.
              Optional: <code>reference</code>{channel === 'whatsapp' && <>, <code>media_url</code>, <code>button_url</code></>}.
            </p>
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0])} />
              <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-4 py-2 text-sm font-semibold text-white"><FileUp className="w-4 h-4" /> Upload CSV</button>
              <button type="button" onClick={sample} className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-4 py-2 text-sm font-semibold hover:bg-surface-secondary"><FileDown className="w-4 h-4" /> Sample CSV</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">{file.name}</span>
              <span className="text-xs text-foreground-muted">{parsed!.recipients.length} recipients</span>
              <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="ml-auto rounded-full p-1.5 text-foreground-muted hover:bg-surface-secondary"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {parsed!.varCols.map(c => <span key={c} className={`rounded-full px-2 py-0.5 ${tpl.tokens.includes(c) ? 'org-sage org-sage-text' : 'org-sand'}`}>{c}</span>)}
              {parsed!.missing.map(c => <span key={c} className="rounded-full bg-[#f6d5cc] px-2 py-0.5 text-[#8a2e1f]">missing: {c}</span>)}
            </div>
            <label className="block text-xs text-foreground-muted">Job name
              <div className="mt-1 flex max-w-sm items-center gap-2"><input value={reference} onChange={e => setReference(e.target.value.slice(0, 120))} className="block h-9 w-full rounded-lg border border-border-default bg-surface-elevated px-3 text-sm text-foreground" />
                <AIEnrichButton placement="inline" fieldLabel="Bulk send name" value={reference} onChange={v => setReference(v.slice(0, 120))} scope="mailer:write" endpoint={ECOM_ENRICH_ENDPOINT} format="plain" maxLength={120} write context={`A short internal name for a bulk message job (channel ${channel}, template ${tpl?.name ?? ''}).`} /></div>
            </label>
            {parsed!.errors.length > 0 && (
              <div className="rounded-lg bg-[#f6d5cc]/60 p-3 text-xs text-[#8a2e1f]">
                <div className="mb-1 font-semibold">{parsed!.errors.length} problem{parsed!.errors.length > 1 ? 's' : ''} — fix the CSV and upload again</div>
                <ul className="list-disc space-y-0.5 pl-4">{parsed!.errors.slice(0, 8).map(e => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {parsed!.missing.length > 0 && <p className="text-xs text-foreground-muted">Add the missing columns — a message without a variable it needs fails (store details and the date are filled in automatically).</p>}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className={`text-xs ${cost > balance ? 'text-[#8a2e1f]' : 'text-foreground-muted'}`}>
                Cost about {fmt(cost)}{channel !== 'email' ? ' (exact after delivery)' : ''} · wallet {fmt(balance)}{cost > balance ? ' — top up, or the job stops part-way' : ''}
              </span>
              <button type="button" disabled={busy || !parsed!.recipients.length || parsed!.errors.length > 0 || parsed!.recipients.length > 10000} onClick={start}
                className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send to {parsed!.recipients.length}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )

  return (
    <BulkJobs
      base={BASE}
      form={form}
      refreshKey={refresh}
      columns={['To', 'Reference', 'Delivery', 'Charged']}
      row={(it: BulkItem) => [
        <span key="t" className="font-mono text-xs">{it.to}</span>,
        <span key="r" className="text-xs">{it.reference ?? '—'}</span>,
        it.result ? <Pill key="d" s={it.result.status} /> : '—',
        it.result ? <span key="c" className="tabular-nums">{fmt(it.result.charged_inr)}</span> : '—',
      ]}
    />
  )
}
