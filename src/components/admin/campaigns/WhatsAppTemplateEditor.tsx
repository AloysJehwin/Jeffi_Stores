'use client'

import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import LibraryTemplatePicker, { type PickedTemplate } from '@/components/admin/messaging-templates/LibraryTemplatePicker'

// Campaign WhatsApp = an APPROVED template from the templates library (Meta only delivers approved
// templates to customers who haven't messaged first). The admin fills its numbered {{n}} slots with
// campaign variables; the preview shows the real approved text.

export interface WhatsAppTemplateValue {
  slug: string | null
  variables: Record<string, string> // {"1": "...", "2": "..."}
}

const inputCls =
  'w-full field-normal border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500'
const COMMON_TOKENS = ['{firstName}', '{items}', '{productName}', '{couponCode}', '{discountPercent}', '{orderNumber}', '{ctaUrl}']
const PH = /\{\{\s*(\d+)\s*\}\}/g

export const waSlots = (body: string) => [...new Set([...(body || '').matchAll(PH)].map(m => m[1]))].sort((a, b) => +a - +b)

/** "…Use code {{2}}" → "Use code". Labels each slot by the words just before it. */
function slotLabel(body: string, n: string): string {
  const before = body.slice(0, body.search(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`))).replace(PH, '…')
  const words = before.split(/\s+/).filter(Boolean).slice(-4).join(' ').replace(/^[^A-Za-z0-9]+/, '')
  return words ? `“…${words}”` : 'Opening'
}

export default function WhatsAppTemplateEditor({
  kind, value, onChange, needsReview, onReviewed,
}: {
  kind: string
  value: WhatsAppTemplateValue
  onChange: (v: WhatsAppTemplateValue) => void
  /** Set by the template migration: the saved values were written for the old slot layout. */
  needsReview?: boolean
  onReviewed?: () => void
}) {
  const [tpl, setTpl] = useState<PickedTemplate | null>(null)
  const slots = tpl ? waSlots(tpl.body) : []
  const samples = ((tpl?.blocks as any)?.variables ?? {}) as Record<string, string>
  const missing = slots.filter(n => !value.variables[n]?.trim())

  return (
    <div className="space-y-3">
      <LibraryTemplatePicker
        channel="whatsapp"
        kind={kind}
        value={value.slug}
        onChange={slug => onChange({ slug, variables: {} })}
        noneLabel="Built-in WhatsApp message for this campaign"
        onLoaded={setTpl}
      />
      {needsReview && value.slug && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-2.5 text-xs text-yellow-800 dark:text-yellow-300 flex items-start justify-between gap-3">
          <span>These values were set for the old template layout. Check each slot below matches the approved text, then confirm.</span>
          <button type="button" onClick={onReviewed} className="shrink-0 font-semibold underline">Looks right</button>
        </div>
      )}
      {tpl && slots.map(n => (
        <div key={n}>
          <label className="block text-[11px] font-medium text-foreground-muted mb-1">
            {slotLabel(tpl.body, n)} <span className="text-foreground-muted/60">({`{{${n}}}`})</span>
          </label>
          <input
            className={inputCls}
            value={value.variables[n] ?? ''}
            onChange={e => onChange({ ...value, variables: { ...value.variables, [n]: e.target.value } })}
            placeholder={samples[n] ? `e.g. ${samples[n]} — or a variable like {firstName}` : 'A variable like {firstName}, or fixed text'}
          />
        </div>
      ))}
      {tpl && slots.length > 0 && (
        <p className="text-[10px] text-foreground-muted">
          Variables resolve per recipient: {COMMON_TOKENS.map(t => <code key={t} className="px-1 mr-1 bg-surface-secondary rounded">{t}</code>)}
          Links are click-tracked automatically.
        </p>
      )}
      {tpl && missing.length > 0 && (
        <p className="text-[10px] text-yellow-700 dark:text-yellow-300">
          Fill every slot — until then the campaign&apos;s built-in WhatsApp message is sent instead.
        </p>
      )}
    </div>
  )
}

// ── Preview (right-hand Preview column) ──
export function WhatsAppPreview({ value, vars }: { value: WhatsAppTemplateValue; vars: Record<string, string | number> }) {
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!value.slug) { setBody(null); return }
    fetch(`/api/admin/messaging-templates/whatsapp/${encodeURIComponent(value.slug)}`)
      .then(r => (r.ok ? r.json() : null)).then(a => live && setBody(a?.current_version?.body ?? null)).catch(() => {})
    return () => { live = false }
  }, [value.slug])
  if (!value.slug || body === null) {
    return <p className="text-xs text-foreground-muted">Select a WhatsApp template to preview the message.</p>
  }
  // Slot values (which may contain {firstName}…) resolved against the sample vars, then placed in {{n}}.
  const fill = (s: string) => s.replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (_m, k: string) => (vars[k] != null ? String(vars[k]) : ''))
  const text = body.replace(PH, (_m, n: string) => fill(value.variables[n] ?? '') || `{{${n}}}`)
  return (
    <div className="rounded-lg p-3 bg-[#e5ddd5] dark:bg-zinc-800 min-h-[120px]">
      <div className="max-w-[88%] rounded-lg rounded-tl-none bg-white dark:bg-zinc-700 shadow-sm px-3 py-2">
        <p className="text-[13px] text-zinc-900 dark:text-zinc-100 whitespace-pre-line leading-snug">{text}</p>
        <p className="text-[10px] text-zinc-400 mt-1 flex items-center justify-end gap-1">
          <MessageCircle className="w-3 h-3" /> WhatsApp
        </p>
      </div>
    </div>
  )
}
