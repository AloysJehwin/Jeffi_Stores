'use client'

import { useCallback, useRef, useState } from 'react'
import AdminImage from '@/components/admin/AdminImage'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite, useCanUseAi } from '@/contexts/AdminScopesContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

export interface OfferSlide {
  id: string
  title: string
  subtitle: string | null
  badge_text: string | null
  badge_color: string | null
  cta_label: string | null
  image_url: string | null
  blurhash: string | null
  image_url_card?: string | null
  blurhash_card?: string | null
  is_active: boolean
  product_count: number
}

type ImageField = 'image_url' | 'image_url_card'
const SLOTS: { field: ImageField; label: string; hint: string; thumb: string }[] = [
  { field: 'image_url_card', label: 'Card image', hint: '4:5, e.g. 1080×1350. The offer cards.', thumb: 'w-8 h-10' },
  { field: 'image_url', label: 'Wide image', hint: '2.4:1, e.g. 1536×640. Listing banners and a lone offer.', thumb: 'w-16 h-10' },
]
const HASH: Record<ImageField, 'blurhash' | 'blurhash_card'> = { image_url: 'blurhash', image_url_card: 'blurhash_card' }

const BADGE_COLORS = [
  { value: 'bg-primary-500', label: 'Primary', swatch: '#7c3aed' },
  { value: 'bg-accent-500', label: 'Accent', swatch: '#84cc16' },
  { value: 'bg-red-500', label: 'Red', swatch: '#ef4444' },
  { value: 'bg-blue-600', label: 'Blue', swatch: '#2563eb' },
  { value: 'bg-emerald-600', label: 'Emerald', swatch: '#059669' },
  { value: 'bg-orange-600', label: 'Orange', swatch: '#ea580c' },
  { value: 'bg-purple-600', label: 'Purple', swatch: '#9333ea' },
  { value: 'bg-rose-600', label: 'Rose', swatch: '#e11d48' },
]

export default function OfferSlideDisplayEditor({
  offer,
  onChange,
}: {
  offer: OfferSlide
  onChange: (patch: Partial<OfferSlide>) => void
}) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('coupons:write')
  const canUseAi = useCanUseAi('coupons:write')
  const storeName = useStoreConfig().identity.name || 'an online store'
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<ImageField | null>(null)
  const [generating, setGenerating] = useState<ImageField | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<ImageField>('image_url_card')
  const busy = uploading !== null || generating !== null

  const save = useCallback(
    async (patch: Partial<Record<string, unknown>>) => {
      setSaving(true)
      try {
        const res = await fetch(`/api/admin/product-offers/${offer.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(patch),
        })
        if (!res.ok) showToast('Failed to save', 'error')
      } catch {
        showToast('Failed to save', 'error')
      } finally {
        setSaving(false)
      }
    },
    [offer.id, showToast]
  )

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const field = pending.current
    if (!file) return
    setUploading(field)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('field', field)
      const res = await fetch(`/api/admin/product-offers/${offer.id}/image`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        onChange({ [field]: data.url, [HASH[field]]: data.blurhash ?? null })
        showToast('Image updated', 'success')
      } else showToast(data.error || 'Upload failed', 'error')
    } catch {
      showToast('Upload failed', 'error')
    } finally {
      setUploading(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function generateImage(field: ImageField) {
    const prompt = aiPrompt.trim()
    if (!prompt || busy) return
    setGenerating(field)
    try {
      const res = await fetch(`/api/admin/product-offers/${offer.id}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt, field }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        onChange({ [field]: data.url, [HASH[field]]: data.blurhash ?? null })
        showToast('Image generated', 'success')
      } else showToast(data.error || 'Image generation failed', 'error')
    } catch {
      showToast('Image generation failed', 'error')
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-border-default bg-surface-secondary/30 p-3 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Card display</span>
        {saving && <span className="text-[10px] text-foreground-muted">Saving…</span>}
      </div>

      <div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
        <div className="space-y-2 mb-2">
          {SLOTS.map(slot => {
            const url = offer[slot.field]
            return (
              <div key={slot.field} className="flex items-center gap-3">
                <div className={`${slot.thumb} rounded-md bg-surface-secondary border border-border-default overflow-hidden shrink-0`}>
                  {url ? (
                    <AdminImage src={url} alt="" blurhash={offer[HASH[slot.field]]} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-foreground-muted/40 text-[10px]">—</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground-secondary">{slot.label}</p>
                  <p className="text-[11px] text-foreground-muted">{slot.hint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    pending.current = slot.field
                    fileRef.current?.click()
                  }}
                  disabled={busy || !canWrite}
                  className="px-3 h-control-sm rounded-lg border border-border-default text-sm hover:bg-surface-secondary disabled:opacity-50 shrink-0"
                >
                  {uploading === slot.field ? 'Uploading…' : url ? 'Replace' : 'Upload'}
                </button>
              </div>
            )
          })}
          {!offer.image_url_card && offer.image_url && (
            <p className="text-[11px] text-foreground-muted">Without a card image, the cards show a centre crop of the wide one.</p>
          )}
        </div>

        {canUseAi && (
          <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 text-violet-500"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                />
              </svg>
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Generate with AI</span>
              <span className="text-[11px] text-violet-500 dark:text-violet-400">Describe the slide image</span>
            </div>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={2}
              placeholder={`e.g. 'Diwali festive sale banner for ${storeName}, warm lights, celebratory'`}
              className="w-full px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700 bg-surface text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SLOTS.map(slot => (
                <button
                  key={slot.field}
                  type="button"
                  onClick={() => generateImage(slot.field)}
                  disabled={busy || !aiPrompt.trim()}
                  className="h-control rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {generating === slot.field ? (
                    <>
                      <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />{' '}
                      Creating…
                    </>
                  ) : (
                    `Generate ${slot.label.toLowerCase()}`
                  )}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-violet-500/80 dark:text-violet-400/80">
              Image generation can take up to a minute.
            </p>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-secondary mb-1">Card copy</label>
        <input
          type="text"
          value={offer.subtitle ?? ''}
          onChange={e => onChange({ subtitle: e.target.value })}
          onBlur={e => save({ subtitle: e.target.value || null })}
          placeholder="Short line shown under the title"
          disabled={!canWrite}
          className="w-full px-3 h-control rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground-secondary mb-1">Badge text</label>
          <input
            type="text"
            value={offer.badge_text ?? ''}
            onChange={e => onChange({ badge_text: e.target.value })}
            onBlur={e => save({ badgeText: e.target.value || null })}
            placeholder="Diwali"
            disabled={!canWrite}
            className="w-full px-3 h-control rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground-secondary mb-1">Badge color</label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {BADGE_COLORS.map(c => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                onClick={() => {
                  onChange({ badge_color: c.value })
                  save({ badgeColor: c.value })
                }}
                disabled={!canWrite}
                className={`w-6 h-6 rounded-full border-2 transition-all disabled:opacity-60 ${offer.badge_color === c.value ? 'border-foreground scale-110' : 'border-transparent'}`}
                style={{ background: c.swatch }}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-secondary mb-1">CTA label</label>
        <input
          type="text"
          value={offer.cta_label ?? ''}
          onChange={e => onChange({ cta_label: e.target.value })}
          onBlur={e => save({ ctaLabel: e.target.value || null })}
          placeholder="Shop the offer"
          disabled={!canWrite}
          className="w-full px-3 h-control rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
        />
      </div>
    </div>
  )
}
