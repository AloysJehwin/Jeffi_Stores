'use client'

import { useCallback, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import MediaField, { type MediaSize, type MediaValue } from '@/components/admin/media/MediaField'

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
  video_url?: string | null
  video_url_card?: string | null
  is_active: boolean
  product_count: number
}

interface Slot {
  key: 'card' | 'wide'
  label: string
  hint: string
  size: MediaSize[]
  image: 'image_url' | 'image_url_card'
  hash: 'blurhash' | 'blurhash_card'
  video: 'video_url' | 'video_url_card'
  /** PATCH body keys. */
  api: { image: string; hash: string; video: string }
  style: string
}

const SLOTS: Slot[] = [
  {
    key: 'card',
    label: 'Card',
    hint: '4:5, e.g. 1080×1350. The offer cards. An MP4 or GIF works too.',
    size: ['portrait', 'square'],
    image: 'image_url_card',
    hash: 'blurhash_card',
    video: 'video_url_card',
    api: { image: 'imageUrlCard', hash: 'blurhashCard', video: 'videoUrlCard' },
    style: 'promotional offer card, cinematic studio lighting, dark near-black background, subject in the upper two thirds leaving calm space at the bottom for text, photorealistic',
  },
  {
    key: 'wide',
    label: 'Wide',
    hint: '2.4:1, e.g. 1536×640. Listing banners and a lone offer.',
    size: ['hero', 'wide'],
    image: 'image_url',
    hash: 'blurhash',
    video: 'video_url',
    api: { image: 'imageUrl', hash: 'blurhash', video: 'videoUrl' },
    style: 'promotional offer banner, cinematic studio lighting, dark near-black background, subject toward the right leaving space on the left for text, photorealistic',
  },
]

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
  const storeName = useStoreConfig().identity.name || 'an online store'
  const [saving, setSaving] = useState(false)

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

  // The image route saves as it uploads (and keeps GIFs); gallery, AI and video picks save through PATCH.
  const uploader = (field: Slot['image']) => async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('field', field)
    const res = await fetch(`/api/admin/product-offers/${offer.id}/image`, { method: 'POST', body: form, credentials: 'include' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed')
    return { url: data.url as string, blurhash: (data.blurhash as string | null) ?? null }
  }

  function setMedia(slot: Slot, next: MediaValue) {
    const video = next.video ?? null
    onChange({ [slot.image]: next.image, [slot.hash]: next.blurhash ?? null, [slot.video]: video })
    save({ [slot.api.image]: next.image, [slot.api.hash]: next.blurhash ?? null, [slot.api.video]: video })
  }

  return (
    <div className="mt-2 rounded-lg border border-border-default bg-surface-secondary/30 p-3 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Card display</span>
        {saving && <span className="text-[10px] text-foreground-muted">Saving…</span>}
      </div>

      <div className="space-y-4">
        {SLOTS.map(slot => (
          <MediaField
            key={slot.key}
            label={`${slot.label} media`}
            hint={slot.hint}
            value={{ image: offer[slot.image] ?? null, blurhash: offer[slot.hash] ?? null, video: offer[slot.video] ?? null }}
            onChange={next => setMedia(slot, next)}
            size={slot.size}
            aiFeature="offer_image"
            videoFeature="offer_video"
            allowVideo
            scope="coupons:write"
            uploadImage={uploader(slot.image)}
            defaultPrompt={`${offer.title} offer at ${storeName}, ${slot.style}`}
            usageRef={offer.id}
          />
        ))}
        {!offer.image_url_card && offer.image_url && (
          <p className="text-[11px] text-foreground-muted">Without a card image, the cards show a centre crop of the wide one.</p>
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
