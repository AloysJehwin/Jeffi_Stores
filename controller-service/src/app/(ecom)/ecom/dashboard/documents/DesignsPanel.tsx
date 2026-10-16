'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ImagePlus, Loader2, Terminal, Trash2 } from 'lucide-react'
import { Card } from '../_components/Card'
import PdfPreview from './PdfPreview'
import { useToast } from '@/contexts/ToastContext'
import PlayDialog, { PlayButton } from '../_components/PlayDialog'
import type { Seller } from './BulkDocuments'
import { ChoiceCards, Segmented, fieldCls, focusRing } from '../../_ui'

interface Design { key: string; name: string; description: string; accent: string; font: string; thumbnail_url: string }
interface Settings { design: string | null; accent: string | null; font: string | null; has_logo: boolean }

const API = '/api/ecom/svc/documents'
const TYPES = [
  { key: 'invoice', label: 'Invoice' }, { key: 'quotation', label: 'Quotation' }, { key: 'receipt', label: 'Receipt' },
  { key: 'packing_slip', label: 'Packing slip' }, { key: 'label', label: 'Label' }, { key: 'purchase_order', label: 'PO' },
]
const SWATCHES = ['#4f46e5', '#0f766e', '#1e3a5f', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#7c3aed', '#db2777', '#111827']
const HEX = /^#[0-9a-fA-F]{6}$/

// Web-font names first; the generic family keeps each card legible when the face isn't installed.
const FONT_STACK: Record<string, string> = {
  modern: 'Inter, ui-sans-serif, system-ui, sans-serif',
  geometric: '"DM Sans", Inter, ui-sans-serif, system-ui, sans-serif',
  classic: 'Lora, Georgia, "Times New Roman", serif',
  editorial: '"Playfair Display", Playfair, Georgia, serif',
  technical: '"IBM Plex Sans", "Plex Sans", ui-sans-serif, system-ui, sans-serif',
  system: '"Noto Sans", ui-sans-serif, system-ui, sans-serif',
}

export default function DesignsPanel({ seller, prices }: { seller: Seller | null; prices: Record<string, number> }) {
  const { showToast } = useToast()
  const [play, setPlay] = useState<{ kind: 'document'; design: string; name: string } | null>(null)
  const [designs, setDesigns] = useState<Design[] | null>(null)
  const [fonts, setFonts] = useState<Array<{ key: string; label: string }>>([])
  const [saved, setSaved] = useState<Settings | null>(null)
  const [design, setDesign] = useState('aurora')
  const [accent, setAccent] = useState<string | null>(null)
  const [hex, setHex] = useState('')
  const [font, setFont] = useState<string | null>(null)
  const [type, setType] = useState('invoice')
  const [logoV, setLogoV] = useState(0)
  const [busy, setBusy] = useState<'save' | 'logo' | null>(null)
  const [copied, setCopied] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([fetch(`${API}/designs`).then(r => r.json()), fetch(`${API}/settings`).then(r => r.json())]).then(([d, s]) => {
      setDesigns(d.designs ?? [])
      setFonts(d.fonts ?? [])
      setSaved(s)
      setDesign(s.design ?? d.default ?? 'aurora')
      setAccent(s.accent)
      setFont(s.font)
    }).catch(() => setDesigns([]))
  }, [])

  const current = designs?.find(d => d.key === design)
  const shownAccent = accent ?? current?.accent ?? '#4f46e5'
  const dirty = !!saved && (design !== (saved.design ?? 'aurora') || accent !== saved.accent || font !== saved.font)

  // Debounced so dragging the colour picker doesn't fire a render per pixel.
  const [previewUrl, setPreviewUrl] = useState('')
  useEffect(() => {
    const q = new URLSearchParams()
    if (accent) q.set('accent', accent)
    if (font) q.set('font', font)
    q.set('v', String(logoV))
    const t = setTimeout(() => setPreviewUrl(`${API}/designs/${design}/preview/${type}?${q}`), 250)
    return () => clearTimeout(t)
  }, [design, type, accent, font, logoV])

  async function save() {
    setBusy('save')
    const r = await fetch(`${API}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ design, accent, font }) })
    const body = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) return showToast(body.message ?? 'Could not save', 'error')
    setSaved(body)
    showToast('Document design saved', 'success')
  }

  async function uploadLogo(f: File | null) {
    if (f && f.size > 1_000_000) return showToast('Logo must be 1 MB or smaller', 'error')
    setBusy('logo')
    const data = f ? await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(f) }) : null
    const r = await fetch(`${API}/settings/logo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) })
    const body = await r.json().catch(() => ({}))
    setBusy(null)
    if (file.current) file.current.value = ''
    if (!r.ok) return showToast(body.message ?? 'Upload failed', 'error')
    setSaved(s => (s ? { ...s, has_logo: body.has_logo } : s))
    setLogoV(v => v + 1)
  }

  const curl = useMemo(() => {
    const body: Record<string, unknown> = {
      template: design,
      ...(accent || font ? { branding: { ...(accent ? { accent } : {}), ...(font ? { font } : {}) } } : {}),
      seller: { name: 'Your Store', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' },
      buyer: { name: 'Priya Sharma', state: 'Tamil Nadu' },
      items: [{ description: 'Cordless drill driver', hsn: '8467', quantity: 1, unit_price: 6499, gst_rate: 18 }],
    }
    return [
      `curl -X POST https://public.jeffistores.in/v1/documents/${type} \\`,
      `  -H "Authorization: Bearer $JEFFI_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${JSON.stringify(body, null, 2)}'`,
    ].join('\n')
  }, [design, accent, font, type])

  if (designs === null) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-xl org-sand" />)}</div>
        <div className="h-[640px] animate-pulse rounded-2xl org-sand" />
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-6">
        <Card title="Design">
          <ChoiceCards ariaLabel="Design" value={design} onChange={setDesign} columns="grid-cols-2 sm:grid-cols-3" cardClassName="overflow-hidden p-0"
            options={designs.map(d => ({
              value: d.key, label: d.name, title: d.description,
              content: (
                <>
                  <div className="relative aspect-[3/4] overflow-hidden bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${API}/designs/${d.key}/thumbnail.png`} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                    <PlayButton className="absolute left-1.5 top-1.5 bg-surface-elevated/90 shadow-sm" onClick={() => setPlay({ kind: 'document', design: d.key, name: d.name })} />
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="text-xs font-semibold text-foreground">{d.name}{saved?.design === d.key && <span className="ml-1.5 text-[10px] font-medium text-foreground-muted">· current</span>}</div>
                  </div>
                </>
              ),
            }))} />
          {current && <p className="mt-3 text-xs text-foreground-secondary">{current.description}</p>}
        </Card>

        <Card title="Branding">
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">Accent colour
                {accent && <button type="button" onClick={() => { setAccent(null); setHex('') }} className="text-xs font-medium text-foreground-muted hover:text-foreground">Use design default</button>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {SWATCHES.map(c => (
                  <button key={c} type="button" aria-label={c} onClick={() => { setAccent(c); setHex(c) }}
                    aria-pressed={shownAccent.toLowerCase() === c}
                    className={`h-7 w-7 rounded-full border border-black/10 ${focusRing} ${shownAccent.toLowerCase() === c ? 'ring-2 ring-offset-2 ring-foreground' : ''}`} style={{ background: c }} />
                ))}
                <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-border-default focus-within:ring-2 focus-within:ring-[var(--org-terracotta)] focus-within:ring-offset-2" style={{ background: shownAccent }} title="Custom colour">
                  <input type="color" value={shownAccent} onChange={e => { setAccent(e.target.value); setHex(e.target.value) }} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <input value={hex || shownAccent} onChange={e => { setHex(e.target.value); if (HEX.test(e.target.value)) setAccent(e.target.value.toLowerCase()) }}
                  aria-label="Accent hex" className={`h-8 w-24 rounded-lg bg-surface-elevated px-2 font-mono text-xs ${fieldCls}`} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">Fonts
                {font && <button type="button" onClick={() => setFont(null)} className="text-xs font-medium text-foreground-muted hover:text-foreground">Use design default</button>}
              </div>
              <ChoiceCards ariaLabel="Font" value={font ?? current?.font ?? null} onChange={setFont} cardClassName="px-4 py-3"
                options={fonts.map(f => {
                  const [name, faces] = f.label.split(' — ')
                  return {
                    value: f.key, label: name,
                    content: (
                      <>
                        <div className="pr-6 text-lg font-semibold leading-tight text-foreground" style={{ fontFamily: FONT_STACK[f.key] }}>{name}</div>
                        {faces && <div className="mt-0.5 text-xs text-foreground-muted">{faces}</div>}
                      </>
                    ),
                  }
                })} />
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Logo</div>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border-default bg-white">
                  {saved?.has_logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`${API}/settings/logo?v=${logoV}`} alt="Logo" className="max-h-12 max-w-[6.5rem] object-contain" />
                    : <span className="text-[11px] text-foreground-muted">No logo</span>}
                </div>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={e => uploadLogo(e.target.files?.[0] ?? null)} />
                <button type="button" disabled={busy === 'logo'} onClick={() => file.current?.click()} className="ecom-focus inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-xs font-semibold hover:bg-surface-secondary disabled:opacity-50">
                  {busy === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {saved?.has_logo ? 'Replace' : 'Upload'}
                </button>
                {saved?.has_logo && <button type="button" aria-label="Remove logo" onClick={() => uploadLogo(null)} className="rounded-full p-1.5 text-foreground-muted hover:bg-surface-secondary hover:text-foreground"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <p className="mt-2 text-xs text-foreground-muted">PNG, JPEG, WebP or SVG up to 1 MB. Saved straight away and used on every document.</p>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-foreground-muted">Unsaved changes</span>}
          <button type="button" disabled={!dirty || busy === 'save'} onClick={save}
            className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Save as default
          </button>
        </div>

        <details className="group rounded-2xl border border-border-default bg-surface-elevated">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 text-sm font-semibold text-foreground-secondary">
            <Terminal className="w-4 h-4" /> Render via API
            <span className="ml-auto text-[11px] font-normal text-foreground-muted group-open:hidden">Show curl</span>
          </summary>
          <div className="space-y-2 px-5 pb-5">
            <div className="relative">
              <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 pr-10 text-[11.5px] leading-relaxed text-zinc-100"><code>{curl}</code></pre>
              <button type="button" aria-label="Copy curl" onClick={() => navigator.clipboard?.writeText(curl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
                className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-zinc-200 hover:bg-white/20">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-foreground-muted">Leave out <code>template</code> and <code>branding</code> to use your saved default. Add <code>branding.logo_url</code> to use a different logo for one call.</p>
          </div>
        </details>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start space-y-3">
        <Segmented ariaLabel="Document type" size="sm" value={type} onChange={setType} options={TYPES.map(t => ({ value: t.key, label: t.label }))} />
        <div className="max-h-[80vh] overflow-y-auto rounded-2xl border border-border-default bg-zinc-100 p-3">
          <PdfPreview url={previewUrl} />
        </div>
        <p className="text-xs text-foreground-muted">Sample data · your logo and the colour/font above. Previews are free.</p>
      </div>
      {play && <PlayDialog target={play} prices={prices} seller={seller} onClose={() => setPlay(null)} />}
    </div>
  )
}
