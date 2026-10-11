'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, Search, X } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import {
  allWhatsAppTemplates,
  isRecommendedForKind,
  getWhatsAppTemplate,
  renderWhatsAppPreview,
  WHATSAPP_IMAGE_RATIO,
} from '@/lib/templates/whatsapp-registry'

export interface WhatsAppTemplateValue {
  key: string | null // our registry key (resolved to a Twilio Content SID at send)
  variables: Record<string, string> // {"1": "...", "2": "..."}
  headerImageUrl: string
}

const inputCls =
  'w-full field-normal border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500'

// Common tokens that resolve per recipient at send (same set the dispatch vars carry). Kind-dependent.
const COMMON_TOKENS = ['{firstName}', '{productName}', '{productImageUrl}', '{couponCode}', '{orderNumber}']

type PickerProduct = { id: string; name: string; image_url: string | null }

// ── Controls (left editor card) ────────────────────────────────────────────────
export default function WhatsAppTemplateEditor({
  kind,
  value,
  onChange,
}: {
  kind: string
  value: WhatsAppTemplateValue
  onChange: (v: WhatsAppTemplateValue) => void
}) {
  const templates = allWhatsAppTemplates()
  const selected = getWhatsAppTemplate(value.key)
  const [imgRatioWarning, setImgRatioWarning] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickerProduct[]>([])

  // Warn (don't block) when the supplied image isn't ~1.91:1 so the preview matches delivery.
  useEffect(() => {
    setImgRatioWarning(null)
    const url = value.headerImageUrl?.trim()
    if (!url || selected?.imageSlot == null || url.includes('{')) return // skip token URLs
    const img = new Image()
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight
      if (Math.abs(r - 1.91) > 0.25) {
        setImgRatioWarning(
          `This image is ${img.naturalWidth}×${img.naturalHeight} (${r.toFixed(2)}:1). WhatsApp shows header images at ~1.91:1 — it will be cropped. Use a 1.91:1 image so recipients see exactly this preview.`
        )
      }
    }
    img.src = url
  }, [value.headerImageUrl, selected?.imageSlot])

  // Product search for the header image (reuses the homepage products API).
  useEffect(() => {
    if (!pickerOpen) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/homepage/products?${new URLSearchParams({ q, limit: '8' })}`, {
        credentials: 'include',
      }).catch(() => null)
      setResults(res?.ok ? (((await res.json()).products ?? []) as PickerProduct[]) : [])
    }, 250)
    return () => clearTimeout(t)
  }, [pickerOpen, q])

  if (templates.length === 0) {
    return <p className="text-xs text-foreground-muted">No approved WhatsApp templates are available yet.</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-foreground-muted mb-1">Template</label>
        <AdminSelect
          value={value.key ?? ''}
          onChange={key => {
            const def = getWhatsAppTemplate(key)
            onChange({ key: key || null, variables: {}, headerImageUrl: def?.imageSlot != null ? value.headerImageUrl : '' })
          }}
          options={[
            { value: '', label: 'Select a WhatsApp template…' },
            ...templates.map(t => ({
              value: t.key,
              label: isRecommendedForKind(t, kind) ? `${t.label} · recommended` : t.label,
            })),
          ]}
        />
        <p className="text-[10px] text-foreground-muted mt-1">
          Any approved WhatsApp template can be used; the one marked “recommended” best fits this campaign.
          Apply for more in Twilio to grow this list.
        </p>
      </div>

      {selected && (
        <>
          {selected.imageSlot != null && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-medium text-foreground-muted">
                  Header image <span className="text-foreground-muted/60">(1.91:1 landscape)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setPickerOpen(o => !o)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-600 hover:text-accent-700"
                >
                  <Search className="w-3 h-3" /> Choose product image
                </button>
              </div>
              <input
                className={inputCls}
                value={value.headerImageUrl}
                onChange={e => onChange({ ...value, headerImageUrl: e.target.value })}
                placeholder="https://…/image.jpg or {productImageUrl}"
              />
              {pickerOpen && (
                <div className="mt-2 rounded-lg border border-border-default bg-surface p-2 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
                    <input
                      autoFocus
                      className={`${inputCls} pl-7 pr-7`}
                      value={q}
                      onChange={e => setQ(e.target.value)}
                      placeholder="Search products…"
                    />
                    <button
                      type="button"
                      onClick={() => setPickerOpen(false)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto grid grid-cols-4 gap-2">
                    {results.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!p.image_url}
                        onClick={() => {
                          if (p.image_url) onChange({ ...value, headerImageUrl: p.image_url })
                          setPickerOpen(false)
                        }}
                        className="rounded border border-border-default p-1 hover:border-accent-500 disabled:opacity-40"
                        title={p.name}
                      >
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt={p.name} className="w-full aspect-square object-cover rounded" />
                        ) : (
                          <span className="block aspect-square bg-surface-secondary rounded" />
                        )}
                        <span className="block text-[9px] text-foreground-muted truncate mt-0.5">{p.name}</span>
                      </button>
                    ))}
                    {results.length === 0 && (
                      <span className="col-span-4 text-[11px] text-foreground-muted py-2 text-center">
                        {q ? 'No products found.' : 'Type to search products.'}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {imgRatioWarning ? (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{imgRatioWarning}</p>
              ) : (
                <p className="text-[10px] text-foreground-muted mt-1">
                  Pick a product, paste a 1.91:1 image (e.g. 1200×628), or use{' '}
                  <code className="px-1 bg-surface-secondary rounded">{'{productImageUrl}'}</code> for the
                  campaign’s subject product. The preview shows exactly what the recipient receives.
                </p>
              )}
            </div>
          )}
          {selected.slots.map(slot => (
            <div key={slot.index}>
              <label className="block text-[11px] font-medium text-foreground-muted mb-1">
                {slot.label} <span className="text-foreground-muted/60">({`{{${slot.index}}}`})</span>
              </label>
              <input
                className={inputCls}
                value={value.variables[String(slot.index)] ?? ''}
                onChange={e =>
                  onChange({ ...value, variables: { ...value.variables, [String(slot.index)]: e.target.value } })
                }
                placeholder="e.g. {firstName} or a fixed value"
              />
            </div>
          ))}
          {selected.slots.length > 0 && (
            <p className="text-[10px] text-foreground-muted">
              Variables resolve per recipient at send: {COMMON_TOKENS.map(t => (
                <code key={t} className="px-1 mr-1 bg-surface-secondary rounded">{t}</code>
              ))}
              (depends on campaign type).
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Preview (rendered in the right-hand Preview column, like the email preview) ──
export function WhatsAppPreview({
  value,
  vars,
}: {
  value: WhatsAppTemplateValue
  vars: Record<string, string | number>
}) {
  const selected = getWhatsAppTemplate(value.key)
  if (!selected) {
    return <p className="text-xs text-foreground-muted">Select a WhatsApp template to preview the message.</p>
  }
  // Fill the template with the admin's slot values, each resolved against the sample vars, so the
  // bubble shows real content (e.g. "Happy Sample!") — not {{1}} / raw tokens.
  const fill = (s: string) =>
    s.replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (_m, k: string) =>
      vars[k] != null ? String(vars[k]) : ''
    )
  const filledVars: Record<string, string> = {}
  for (const [k, v] of Object.entries(value.variables)) filledVars[k] = fill(String(v ?? ''))
  const previewBody = renderWhatsAppPreview(selected, filledVars)
  const imgUrl = value.headerImageUrl ? fill(value.headerImageUrl) : ''

  return (
    <div className="rounded-lg p-3 bg-[#e5ddd5] dark:bg-zinc-800 min-h-[160px]">
      <div className="max-w-[88%] rounded-lg rounded-tl-none bg-white dark:bg-zinc-700 shadow-sm overflow-hidden">
        {selected.imageSlot != null && (
          <div
            className="w-full bg-zinc-100 dark:bg-zinc-600 flex items-center justify-center overflow-hidden"
            style={{ aspectRatio: WHATSAPP_IMAGE_RATIO }}
          >
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] text-zinc-400">Header image (1.91:1)</span>
            )}
          </div>
        )}
        <div className="px-3 py-2">
          <p className="text-[13px] text-zinc-900 dark:text-zinc-100 whitespace-pre-line leading-snug">
            {previewBody}
          </p>
          <p className="text-[10px] text-zinc-400 mt-1 flex items-center justify-end gap-1">
            <MessageCircle className="w-3 h-3" /> WhatsApp
          </p>
        </div>
      </div>
    </div>
  )
}
