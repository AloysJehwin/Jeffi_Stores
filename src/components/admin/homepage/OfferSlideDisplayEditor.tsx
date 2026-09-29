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
  is_active: boolean
  product_count: number
}

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

export default function OfferSlideDisplayEditor({ offer, onChange }: {
  offer: OfferSlide
  onChange: (patch: Partial<OfferSlide>) => void
}) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('coupons:write')
  const canUseAi = useCanUseAi('coupons:write')
  const storeName = useStoreConfig().identity.name || 'an online store'
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const save = useCallback(async (patch: Partial<Record<string, unknown>>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/product-offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (!res.ok) showToast('Failed to save', 'error')
    } catch { showToast('Failed to save', 'error') } finally { setSaving(false) }
  }, [offer.id, showToast])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('field', 'image_url')
      const res = await fetch(`/api/admin/product-offers/${offer.id}/image`, { method: 'POST', body: form, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        onChange({ image_url: data.url, blurhash: data.blurhash ?? null })
        showToast('Image updated', 'success')
      } else showToast(data.error || 'Upload failed', 'error')
    } catch { showToast('Upload failed', 'error') } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function generateImage() {
    const prompt = aiPrompt.trim()
    if (!prompt || generating) return
    setGenerating(true)
    try {
      const res = await fetch(`/api/admin/product-offers/${offer.id}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt, field: 'image_url' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        onChange({ image_url: data.url, blurhash: data.blurhash ?? null })
        showToast('Image generated', 'success')
      } else showToast(data.error || 'Image generation failed', 'error')
    } catch { showToast('Image generation failed', 'error') } finally { setGenerating(false) }
  }

  return (
    <div className="mt-2 rounded-lg border border-border-default bg-surface-secondary/30 p-3 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Card display</span>
        {saving && <span className="text-[10px] text-foreground-muted">Saving…</span>}
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Slide image</label>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-16 h-10 rounded-lg bg-surface-secondary border border-border-default overflow-hidden shrink-0">
            {offer.image_url
              ? <AdminImage src={offer.image_url} alt="" blurhash={offer.blurhash} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-foreground-muted/40 text-[10px]">No image</div>}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || generating || !canWrite}
            className="px-3 py-1.5 rounded-lg border border-border-default text-sm hover:bg-surface-secondary disabled:opacity-50">
            {uploading ? 'Uploading…' : offer.image_url ? 'Replace image' : 'Upload image'}
          </button>
        </div>

        {canUseAi && (
          <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Generate with AI</span>
              <span className="text-[11px] text-violet-500 dark:text-violet-400">Describe the slide image</span>
            </div>
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2}
              placeholder={`e.g. 'Diwali festive sale banner for ${storeName}, warm lights, celebratory'`}
              className="w-full px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700 bg-surface text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
            <button type="button" onClick={generateImage} disabled={generating || !aiPrompt.trim()}
              className="mt-2 w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {generating
                ? (<><span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" /> Creating image…</>)
                : 'Generate image'}
            </button>
            <p className="mt-1.5 text-[11px] text-violet-500/80 dark:text-violet-400/80">Image generation can take up to a minute.</p>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-secondary mb-1">Card copy</label>
        <input type="text" value={offer.subtitle ?? ''}
          onChange={e => onChange({ subtitle: e.target.value })}
          onBlur={e => save({ subtitle: e.target.value || null })}
          placeholder="Short line shown under the title"
          disabled={!canWrite}
          className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground-secondary mb-1">Badge text</label>
          <input type="text" value={offer.badge_text ?? ''}
            onChange={e => onChange({ badge_text: e.target.value })}
            onBlur={e => save({ badgeText: e.target.value || null })}
            placeholder="Diwali"
            disabled={!canWrite}
            className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground-secondary mb-1">Badge color</label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {BADGE_COLORS.map(c => (
              <button key={c.value} type="button" title={c.label}
                onClick={() => { onChange({ badge_color: c.value }); save({ badgeColor: c.value }) }}
                disabled={!canWrite}
                className={`w-6 h-6 rounded-full border-2 transition-all disabled:opacity-60 ${offer.badge_color === c.value ? 'border-foreground scale-110' : 'border-transparent'}`}
                style={{ background: c.swatch }} />
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-secondary mb-1">CTA label</label>
        <input type="text" value={offer.cta_label ?? ''}
          onChange={e => onChange({ cta_label: e.target.value })}
          onBlur={e => save({ ctaLabel: e.target.value || null })}
          placeholder="Shop the offer"
          disabled={!canWrite}
          className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
      </div>
    </div>
  )
}
