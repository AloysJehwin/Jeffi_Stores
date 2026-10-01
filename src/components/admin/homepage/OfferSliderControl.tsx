'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import AdminImage from '@/components/admin/AdminImage'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { HomepageSection } from '@/lib/catalog/homepage-sections'
import type { SaveSectionConfig } from './HomepageSectionManager'
import OfferSlideDisplayEditor, { type OfferSlide } from './OfferSlideDisplayEditor'

interface OfferOption extends OfferSlide {}

function readOfferIds(section: HomepageSection): string[] {
  const raw = (section.config ?? {}).offerIds
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

export default function OfferSliderControl({
  section,
  saveConfig,
}: {
  section: HomepageSection
  saveConfig: SaveSectionConfig
}) {
  const { showToast } = useToast()
  const canPick = useCanWrite('settings:write')
  const [offers, setOffers] = useState<OfferOption[]>([])
  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState<string[]>(() => readOfferIds(section))
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    setOrder(readOfferIds(section))
  }, [section])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/product-offers', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setOffers(Array.isArray(d.offers) ? d.offers : [])
    } catch {
      showToast('Could not load offers', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  const byId = useMemo(() => new Map(offers.map(o => [o.id, o])), [offers])

  // Chosen offers first, in saved order; then the rest for picking.
  const chosen = order.filter(id => byId.has(id))
  const unchosen = offers.filter(o => !chosen.includes(o.id))
  const rows = [...chosen.map(id => byId.get(id)!), ...unchosen]

  function persist(next: string[]) {
    setOrder(next)
    saveConfig({ offerIds: next })
  }

  function toggle(id: string, checked: boolean) {
    if (!canPick) return
    persist(checked ? [...order.filter(x => x !== id), id] : order.filter(x => x !== id))
    if (checked) setEditing(id)
    else setEditing(prev => (prev === id ? null : prev))
  }

  function move(id: string, dir: -1 | 1) {
    if (!canPick) return
    const idx = chosen.indexOf(id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= chosen.length) return
    const next = [...chosen]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    persist(next)
  }

  const patchOffer = useCallback((id: string, patch: Partial<OfferSlide>) => {
    setOffers(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)))
  }, [])

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2 text-xs text-foreground-muted">
        Pick which offers appear as slides, set their order, and style each card here. Checked offers show first, in the
        order below.{' '}
        <a href={ap('/admin/offers?tab=offers')} className="text-accent-600 dark:text-accent-400 hover:underline">
          Edit offer data and products in the Offers page
        </a>
        .
      </div>

      {loading ? (
        <p className="text-xs text-foreground-muted py-3 text-center">Loading offers…</p>
      ) : offers.length === 0 ? (
        <p className="text-xs text-foreground-muted py-3 text-center">
          No offers yet.{' '}
          <a href={ap('/admin/offers?tab=offers')} className="text-accent-600 dark:text-accent-400 hover:underline">
            Create one in the Offers page
          </a>
          .
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(offer => {
            const checked = chosen.includes(offer.id)
            const pos = chosen.indexOf(offer.id)
            const isEditing = editing === offer.id
            return (
              <li key={offer.id} className="rounded-lg border border-border-default bg-surface px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canPick}
                    onChange={e => toggle(offer.id, e.target.checked)}
                    className="w-4 h-4 shrink-0 accent-accent-500 disabled:opacity-40"
                    aria-label={`Include ${offer.title} in the slider`}
                  />

                  <div className="w-9 h-9 shrink-0 overflow-hidden rounded bg-surface-secondary">
                    {offer.image_url && (
                      <AdminImage
                        src={offer.image_url}
                        alt=""
                        blurhash={offer.blurhash}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <span className="block text-sm text-foreground truncate">{offer.title}</span>
                    <span className="block text-[11px] text-foreground-muted truncate">
                      {offer.badge_text ? `${offer.badge_text} · ` : ''}
                      {offer.product_count} product{offer.product_count === 1 ? '' : 's'}
                      {!offer.is_active && ' · hidden'}
                    </span>
                  </div>

                  {checked && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(isEditing ? null : offer.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0 hover:bg-surface-secondary ${isEditing ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-muted hover:text-foreground'}`}
                        aria-label={`Edit ${offer.title} card display`}
                        aria-expanded={isEditing}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {isEditing ? 'Done' : 'Edit card'}
                      </button>
                      <div className="flex flex-col shrink-0">
                        <button
                          type="button"
                          onClick={() => move(offer.id, -1)}
                          disabled={!canPick || pos === 0}
                          className="p-0.5 rounded text-foreground-muted hover:text-foreground disabled:opacity-30"
                          aria-label={`Move ${offer.title} up`}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(offer.id, 1)}
                          disabled={!canPick || pos === chosen.length - 1}
                          className="p-0.5 rounded text-foreground-muted hover:text-foreground disabled:opacity-30"
                          aria-label={`Move ${offer.title} down`}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {checked && isEditing && (
                  <OfferSlideDisplayEditor offer={offer} onChange={patch => patchOffer(offer.id, patch)} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
