'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Copy, Download, Loader2, Play, Plus, Trash2, X } from 'lucide-react'
import { toEditorTemplate, type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'
import { AUTO_VARIABLES, curlFor, templateCallFields } from '@/components/admin/messaging-templates/template-call-fields'
import AdminSelect from '@/components/admin/AdminSelect'
import PdfPreview from '../documents/PdfPreview'
import { fmt } from './finance'

// ▶ Play: one real send/render through POST /api/ecom/play on behalf of a chosen live API key.

interface Key { id: string; name: string; key_prefix: string; scopes: string[]; status: string }
interface Party { name: string; gstin?: string; address?: string; phone?: string; email?: string; state?: string }
type Item = { description: string; quantity: string; unit_price: string; gst_rate: string }

export const DOC_TYPES = [
  { key: 'invoice', label: 'Invoice' }, { key: 'quotation', label: 'Quotation' }, { key: 'receipt', label: 'Receipt' },
  { key: 'packing_slip', label: 'Packing slip' }, { key: 'label', label: 'Label' }, { key: 'purchase_order', label: 'PO' },
]

export type PlayTarget =
  | { kind: 'message'; channel: Channel; slug: string; name?: string; template?: EditorTemplate }
  | { kind: 'document'; design: string; name?: string }

const input = 'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'
const MSG = '/api/ecom/svc/messaging'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground-secondary">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-foreground-muted">{hint}</span>}
    </label>
  )
}

const compact = (p: Party) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v)) as unknown as Party

export function PlayButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <span role="button" tabIndex={0} title="Test live" aria-label="Test live"
      onClick={e => { e.stopPropagation(); onClick() }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick() } }}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-1.5 text-foreground-muted hover:bg-surface-secondary hover:text-foreground ${className}`}>
      <Play className="w-3.5 h-3.5" />
    </span>
  )
}

export default function PlayDialog({ target, prices, seller, onClose }: {
  target: PlayTarget
  prices: Record<string, number>
  seller?: Party | null
  onClose: () => void
}) {
  const scope = target.kind === 'message' ? 'messages:send' : 'documents:render'
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [keyId, setKeyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ status: number; body: any } | null>(null)
  const [copied, setCopied] = useState(false)

  // message
  const [tpl, setTpl] = useState<EditorTemplate | null>(target.kind === 'message' ? target.template ?? null : null)
  const [missing, setMissing] = useState<string[] | null>(null)
  const [to, setTo] = useState('')
  const [vars, setVars] = useState<Record<string, string>>({})
  const [mediaUrl, setMediaUrl] = useState('')
  const [buttonUrl, setButtonUrl] = useState('')

  // document
  const [type, setType] = useState('invoice')
  const [sell, setSell] = useState<Party>({ name: seller?.name ?? '', gstin: seller?.gstin ?? '', address: seller?.address ?? '', phone: seller?.phone ?? '', state: '' })
  const [buyer, setBuyer] = useState<Party>({ name: '', email: '' })
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: '1', unit_price: '', gst_rate: '18' }])
  const [number, setNumber] = useState('')
  const [date, setDate] = useState('')

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  useEffect(() => {
    fetch('/api/ecom/api-keys').then(r => r.json()).then(d => {
      const live = (d.keys ?? []).filter((k: Key) => k.status === 'active' && k.scopes?.includes(scope))
      setKeys(live)
      if (live[0]) setKeyId(live[0].id)
    }).catch(() => setKeys([]))
  }, [scope])

  useEffect(() => {
    if (target.kind !== 'message') return
    const { channel, slug } = target
    if (!target.template) {
      fetch(`${MSG}/v2/templates/${channel}/${encodeURIComponent(slug)}`).then(r => (r.ok ? r.json() : null)).then(d => d && setTpl(toEditorTemplate(d))).catch(() => {})
    }
    // Variables the template needs that the API doesn't fill itself (store details etc.).
    fetch(`${MSG}/v2/templates/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, slug, variables: {} }) })
      .then(r => (r.ok ? r.json() : null)).then(d => setMissing(d?.missing ?? [])).catch(() => setMissing([]))
  }, [target])

  const fields = useMemo(() => (tpl ? templateCallFields(tpl) : null), [tpl])
  const varNames = useMemo(() => {
    if (target.kind !== 'message') return []
    if (target.channel === 'whatsapp') return Object.keys(fields?.variables ?? {})
    const fromTpl = Object.keys(fields?.variables ?? {})
    return [...new Set([...(missing ?? []), ...fromTpl])].filter(k => !AUTO_VARIABLES.has(k) && !/^\d+$/.test(k))
  }, [target, fields, missing])

  const request = useMemo((): Record<string, unknown> => {
    if (target.kind === 'message') {
      const v = Object.fromEntries(varNames.map(k => [k, vars[k] ?? '']))
      return {
        channel: target.channel, template: target.slug, to: to.trim(),
        ...(varNames.length ? { variables: v } : {}),
        ...(fields?.mediaSlot && mediaUrl.trim() ? { media_url: mediaUrl.trim() } : {}),
        ...(fields?.buttonSlot && buttonUrl.trim() ? { button_url: buttonUrl.trim() } : {}),
      }
    }
    return {
      template: target.design,
      ...(number.trim() ? { number: number.trim() } : {}),
      ...(date ? { date } : {}),
      seller: compact(sell),
      buyer: compact(buyer),
      items: items.map(i => ({ description: i.description.trim(), quantity: Number(i.quantity), unit_price: Number(i.unit_price), gst_rate: Number(i.gst_rate) })),
    }
  }, [target, varNames, vars, to, fields, mediaUrl, buttonUrl, number, date, sell, buyer, items])

  const curl = target.kind === 'message' ? curlFor('/v1/messages', request) : curlFor(`/v1/documents/${type}`, request, false)
  const price = target.kind === 'message' ? prices[target.channel] : prices[type]

  async function run() {
    setBusy(true)
    setResult(null)
    try {
      const body = target.kind === 'message' ? { apiKeyId: keyId, kind: 'message', ...request } : { apiKeyId: keyId, kind: 'document', type, ...request }
      const r = await fetch('/api/ecom/play', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      setResult({ status: r.status, body: await r.json().catch(() => ({})) })
    } catch {
      setResult({ status: 0, body: { error: 'Network error' } })
    } finally { setBusy(false) }
  }

  const setItem = (i: number, patch: Partial<Item>) => setItems(list => list.map((it, n) => (n === i ? { ...it, ...patch } : it)))
  const ok = result && result.status >= 200 && result.status < 300
  const err = result && !ok ? (result.body?.message || result.body?.error?.message || result.body?.error || `Request failed (${result.status})`) : null
  const ready = !!keyId && (target.kind === 'message' ? !!to.trim() && missing !== null : !!sell.name?.trim() && !!buyer.name?.trim() && items.every(i => i.description.trim() && Number(i.quantity) > 0 && i.unit_price !== ''))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Test live">
      <div className="fixed inset-0 bg-foreground/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-border-default bg-surface-elevated p-6 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 hover:bg-surface-secondary"><X className="w-4 h-4" /></button>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">Test live</h2>
        <p className="mt-1 text-lg font-semibold">
          {target.kind === 'message' ? <>{target.name || target.slug} <span className="text-sm font-normal text-foreground-muted capitalize">· {target.channel}</span></> : <>{target.name || target.design} <span className="text-sm font-normal text-foreground-muted">· design</span></>}
        </p>

        <div className="mt-5 space-y-4">
          <Field label="API key">
            {keys === null ? <div className="h-9 animate-pulse rounded-lg org-sand" />
              : keys.length === 0 ? <p className="text-sm text-foreground-secondary">No active key with <code>{scope}</code>. <Link href="/dashboard/api-keys" className="font-semibold ecom-accent-text underline">Create one</Link>.</p>
              : <AdminSelect value={keyId} onChange={setKeyId} options={keys.map(k => ({ value: k.id, label: k.name, hint: `${k.key_prefix}…` }))} />}
          </Field>

          {target.kind === 'message' ? (
            <>
              <Field label={target.channel === 'email' ? 'Recipient email' : 'Recipient phone'} hint={target.channel === 'email' ? undefined : 'With country code, e.g. +919876543210'}>
                <input className={input} type={target.channel === 'email' ? 'email' : 'tel'} value={to} onChange={e => setTo(e.target.value)} placeholder={target.channel === 'email' ? 'you@example.com' : '+91…'} />
              </Field>
              {missing === null && <div className="h-9 animate-pulse rounded-lg org-sand" />}
              {varNames.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {varNames.map(k => (
                    <Field key={k} label={/^\d+$/.test(k) ? `{{${k}}}` : k}>
                      <input className={input} value={vars[k] ?? ''} placeholder={fields?.variables?.[k] ?? ''} onChange={e => setVars(v => ({ ...v, [k]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              )}
              {fields?.mediaSlot && <Field label="Image URL (media_url)"><input className={input} value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="https://…/photo.jpg" /></Field>}
              {fields?.buttonSlot && <Field label="Button link (button_url)"><input className={input} value={buttonUrl} onChange={e => setButtonUrl(e.target.value)} placeholder="https://…" /></Field>}
            </>
          ) : (
            <>
              <Field label="Document type">
                <AdminSelect value={type} onChange={setType} options={DOC_TYPES.map(t => ({ value: t.key, label: t.label }))} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Seller name"><input className={input} value={sell.name} onChange={e => setSell({ ...sell, name: e.target.value })} /></Field>
                <Field label="Seller GSTIN"><input className={input} value={sell.gstin ?? ''} onChange={e => setSell({ ...sell, gstin: e.target.value })} /></Field>
                <Field label="Seller address"><input className={input} value={sell.address ?? ''} onChange={e => setSell({ ...sell, address: e.target.value })} /></Field>
                <Field label="Seller state"><input className={input} value={sell.state ?? ''} onChange={e => setSell({ ...sell, state: e.target.value })} /></Field>
                <Field label="Buyer name"><input className={input} value={buyer.name} onChange={e => setBuyer({ ...buyer, name: e.target.value })} /></Field>
                <Field label="Buyer email"><input className={input} type="email" value={buyer.email ?? ''} onChange={e => setBuyer({ ...buyer, email: e.target.value })} /></Field>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-foreground-secondary">Items</div>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="grid grid-cols-[1fr_4rem_6rem_4rem_auto] items-center gap-2">
                      <input className={input} aria-label="Description" placeholder="Description" value={it.description} onChange={e => setItem(i, { description: e.target.value })} />
                      <input className={input} aria-label="Quantity" type="number" min="1" value={it.quantity} onChange={e => setItem(i, { quantity: e.target.value })} />
                      <input className={input} aria-label="Unit price" type="number" min="0" placeholder="Price" value={it.unit_price} onChange={e => setItem(i, { unit_price: e.target.value })} />
                      <input className={input} aria-label="GST %" type="number" min="0" max="28" value={it.gst_rate} onChange={e => setItem(i, { gst_rate: e.target.value })} />
                      <button type="button" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems(list => list.filter((_, n) => n !== i))} className="rounded-full p-1.5 text-foreground-muted hover:bg-surface-secondary disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setItems(list => [...list, { description: '', quantity: '1', unit_price: '', gst_rate: '18' }])} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-foreground-secondary hover:text-foreground"><Plus className="w-3.5 h-3.5" /> Add item</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Number (optional)" hint="Left blank, the next number in your series is used"><input className={input} value={number} onChange={e => setNumber(e.target.value)} /></Field>
                <Field label="Date (optional)"><input className={input} type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
              </div>
            </>
          )}

          <details className="rounded-lg border border-border-default bg-surface-secondary/40">
            <summary className="cursor-pointer select-none px-4 py-2 text-xs font-semibold text-foreground-secondary">Equivalent curl</summary>
            <div className="relative px-4 pb-4">
              <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 pr-10 text-[11.5px] leading-relaxed text-zinc-100"><code>{curl}</code></pre>
              <button type="button" aria-label="Copy curl" onClick={() => navigator.clipboard?.writeText(curl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
                className="absolute right-6 top-2 rounded-md bg-white/10 p-1.5 text-zinc-200 hover:bg-white/20">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </details>

          <p className="flex items-start gap-2 rounded-xl org-peach px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
            <span>
              {target.kind === 'message' ? 'This sends a real message' : 'This renders a real document'} and is billed to your wallet
              {price != null && <> — <strong>{fmt(price)}</strong></>}.
            </span>
          </p>

          {err && <p className="rounded-xl bg-[#f6d5cc]/60 px-4 py-3 text-sm text-[#8a2e1f]">{String(err)}</p>}
          {ok && target.kind === 'message' && (
            <div className="rounded-xl org-sage px-4 py-3 text-sm">
              <div className="font-semibold capitalize">{result.body.status ?? 'queued'}</div>
              <div className="mt-0.5 font-mono text-xs">{result.body.id}</div>
              {result.body.error && <div className="mt-1 text-[#8a2e1f]">{result.body.error}</div>}
            </div>
          )}
          {ok && target.kind === 'document' && result.body.pdf_url && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{result.body.number ?? 'Rendered'}</span>
                <a href={result.body.pdf_url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 text-xs font-semibold ecom-accent-text"><Download className="w-3.5 h-3.5" /> Open PDF</a>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border-default bg-zinc-100 p-3"><PdfPreview url={result.body.pdf_url} /></div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-foreground-secondary hover:text-foreground">Close</button>
            <button type="button" disabled={!ready || busy} onClick={run} className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
