'use client'

import { useEffect, useRef, useState } from 'react'
import { Braces, ImageIcon, Link2, MessageCircle } from 'lucide-react'
import { BUILTIN_TEMPLATE_VARIABLES } from '@/lib/templates/variables-shared'
import ImageUrlInput from '@/components/admin/ImageUrlInput'

// Every parameter an approved WhatsApp template needs on send: body {{n}} slots, plus the header
// image and link button of `_action` templates (their {{n}} sit after a Meta-approved prefix).

const PH = /\{\{\s*(\d+)\s*\}\}/
const PH_G = /\{\{\s*(\d+)\s*\}\}/g

export interface WaParams {
  body: Array<{ n: string; sample: string; context: string }>
  media: { slot: string; prefix: string; sample: string } | null
  button: { slot: string; prefix: string; label: string } | null
}

export function waParams(body: string, blocks: any): WaParams {
  const samples: Record<string, string> = blocks?.variables ?? {}
  const slots = [...new Set([...(body || '').matchAll(PH_G)].map(m => m[1]))].sort((a, b) => +a - +b)
  const context = (n: string) => {
    const i = body.search(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`))
    const before = body.slice(Math.max(0, i - 28), i).replace(PH_G, '…')
    const after = body.slice(i).replace(PH, '').slice(0, 28).replace(PH_G, '…')
    return `${i > 28 ? '…' : ''}${before}▢${after}${i + 28 < body.length ? '…' : ''}`
  }
  const media: string = blocks?.types?.['twilio/media']?.media?.[0] ?? ''
  const mSlot = media.match(PH)?.[1]
  const btn = (blocks?.buttons ?? []).find((b: any) => b.type === 'url' && PH.test(b.value ?? ''))
  const bSlot = btn?.value.match(PH)?.[1]
  return {
    body: slots.map(n => ({ n, sample: samples[n] ?? '', context: context(n) })),
    media: mSlot ? { slot: mSlot, prefix: media.slice(0, media.search(PH)), sample: samples[mSlot] ?? '' } : null,
    button: bSlot ? { slot: bSlot, prefix: btn.value.slice(0, btn.value.search(PH)), label: btn.label || 'Button' } : null,
  }
}

// Values the campaign send resolves per customer: its own scenario vars + the registered ones.
const VARS: Array<{ token: string; label: string; group: string }> = [
  { token: '{firstName}', label: 'First name', group: 'Customer' },
  { token: '{couponCode}', label: 'Coupon code', group: 'Offer' },
  { token: '{discountPercent}', label: 'Discount %', group: 'Offer' },
  ...BUILTIN_TEMPLATE_VARIABLES.filter(v => v.key !== 'customer_first_name').map(v => ({ token: `{{${v.key}}}`, label: v.label, group: v.group[0].toUpperCase() + v.group.slice(1) })),
]

export function InsertVariable({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const groups = [...new Set(VARS.map(v => v.group))]
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex h-full items-center gap-1 rounded-lg border border-border-default px-2.5 text-xs font-semibold text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-900/30">
        <Braces className="w-3.5 h-3.5" /> Insert variable
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-border-default bg-surface-elevated p-1 shadow-lg">
          {groups.map(g => (
            <div key={g}>
              <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">{g}</p>
              {VARS.filter(v => v.group === g).map(v => (
                <button key={v.token} type="button" onClick={() => { onInsert(v.token); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-secondary">
                  <span>{v.label}</span><code className="text-[10px] text-foreground-muted">{v.token}</code>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A text input (or textarea) with an Insert-variable menu that inserts at the cursor. */
export function VarInput({ value, onChange, placeholder, className, rows }: { value: string; onChange: (v: string) => void; placeholder?: string; className: string; rows?: number }) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const insert = (t: string) => {
    const el = ref.current
    const at = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? at
    onChange(value.slice(0, at) + t + value.slice(end))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + t.length, at + t.length) })
  }
  return (
    <div className={`flex gap-2 ${rows ? 'items-start' : ''}`}>
      {rows
        ? <textarea ref={ref} rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${className} flex-1 min-w-0 resize-none`} />
        : <input ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${className} flex-1 min-w-0`} />}
      <div className={rows ? 'h-9' : ''}><InsertVariable onInsert={insert} /></div>
    </div>
  )
}

export default function WaParamsForm({ params, vars, setVars, mediaUrl, setMediaUrl, linkUrl, setLinkUrl, inputClass }: {
  params: WaParams
  vars: Record<string, string>
  setVars: (fn: (p: Record<string, string>) => Record<string, string>) => void
  mediaUrl: string
  setMediaUrl: (v: string) => void
  linkUrl: string
  setLinkUrl: (v: string) => void
  inputClass: string
}) {
  const badImage = !!params.media && !!mediaUrl && !mediaUrl.startsWith(params.media.prefix)
  if (!params.body.length && !params.media && !params.button) return null
  return (
    <div className="space-y-4 rounded-lg border border-border-default p-4">
      <p className="text-xs font-semibold text-foreground-secondary flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp — fill in the template</p>
      {params.body.map((s, i) => (
        <div key={s.n}>
          <label className="block text-sm font-medium text-foreground">Text {i + 1} <code className="ml-1 text-[11px] font-normal text-foreground-muted">{`{{${s.n}}}`}</code></label>
          <p className="mb-1.5 text-[11px] text-foreground-muted">Goes here: “{s.context}”</p>
          <VarInput className={inputClass} value={vars[s.n] ?? ''} onChange={v => setVars(p => ({ ...p, [s.n]: v }))}
            placeholder={s.sample ? `e.g. ${s.sample}` : 'Fixed text, or insert a variable'} />
        </div>
      ))}
      {params.media && (
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-foreground"><ImageIcon className="w-3.5 h-3.5" /> Header image</label>
          <p className="mb-1.5 text-[11px] text-foreground-muted">Upload an image, or paste a URL starting with <code>{params.media.prefix}</code> (any product or banner image from your store). Leave empty to use your store logo.</p>
          <ImageUrlInput value={mediaUrl} onChange={v => setMediaUrl(v.trim())} placeholder={`${params.media.prefix}${params.media.sample || 'products/…/photo.jpg'}`} className={inputClass} />
          {badImage && <p className="mt-1 text-xs text-red-600">WhatsApp only accepts images under {params.media.prefix} for this template.</p>}
        </div>
      )}
      {params.button && (
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Link2 className="w-3.5 h-3.5" /> “{params.button.label}” button link</label>
          <p className="mb-1.5 text-[11px] text-foreground-muted">Where the button opens — any page of your store. Sent as a short {params.button.prefix}… link. Leave empty for your homepage.</p>
          <input value={linkUrl} onChange={e => setLinkUrl(e.target.value.trim())} placeholder="https://your-store/products/…" className={inputClass} />
        </div>
      )}
    </div>
  )
}

/** "…text before ▢ text after…" around the first `{name}` / `{{name}}` in the given texts (HTML stripped). */
export function usageContext(name: string, ...texts: Array<string | null | undefined>): string | null {
  const re = new RegExp(`\\{\\{?\\s*${name}\\s*\\}?\\}`)
  for (const raw of texts) {
    const t = (raw ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g, '{$1}')
    const i = t.search(re)
    if (i < 0) continue
    const m = t.match(re)![0]
    const before = t.slice(Math.max(0, i - 30), i), after = t.slice(i + m.length, i + m.length + 30)
    return `${i > 30 ? '…' : ''}${before}▢${after}${i + m.length + 30 < t.length ? '…' : ''}`
  }
  return null
}
