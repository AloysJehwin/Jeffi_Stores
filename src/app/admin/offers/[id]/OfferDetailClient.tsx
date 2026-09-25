'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import Toggle from '@/components/ui/Toggle'
import OfferProductPicker, { type AssignOption } from '@/components/admin/OffersProductPicker'
import type { ProductOffer } from '@/lib/product-offers-shared'

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Dates are the admin's local calendar days; an end date keeps the offer live through that whole day.
function fromDateInput(value: string, endOfDay: boolean): string | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  const local = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)
  return local.toISOString()
}

const INPUT_CLASS = 'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60'

export default function OfferDetailClient({ offer, backHref, categoryOptions, brandOptions }: {
  offer: ProductOffer
  backHref: string
  categoryOptions: AssignOption[]
  brandOptions: AssignOption[]
}) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('coupons:write')
  const [title, setTitle] = useState(offer.title)
  const [savedTitle, setSavedTitle] = useState(offer.title)
  const [startsAt, setStartsAt] = useState<string | null>(offer.starts_at)
  const [endsAt, setEndsAt] = useState<string | null>(offer.ends_at)
  const [isActive, setIsActive] = useState(offer.is_active)
  const [saving, setSaving] = useState(false)

  const save = useCallback(async (patch: Record<string, unknown>): Promise<boolean> => {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/product-offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (!res.ok) showToast('Failed to save', 'error')
      return res.ok
    } catch {
      showToast('Failed to save', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [offer.id, showToast])

  async function commitTitle() {
    const next = title.trim()
    if (!next) { setTitle(savedTitle); return }
    if (next === savedTitle) return
    if (await save({ title: next })) setSavedTitle(next)
  }

  return (
    <div className="p-4 sm:p-6 w-full max-w-full min-w-0">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href={backHref} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Offers
        </Link>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium truncate">{title || 'Untitled offer'}</span>
        {saving && <span className="ml-2 text-[11px] text-foreground-muted">Saving…</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] items-start">
        <div className="space-y-4 min-w-0">
          <div className="space-y-5 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-foreground">Offer details</h2>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={commitTitle}
                maxLength={255}
                disabled={!canWrite}
                className={INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Launch date</label>
                <input
                  type="date"
                  value={toDateInput(startsAt)}
                  onChange={e => {
                    const v = fromDateInput(e.target.value, false)
                    setStartsAt(v)
                    save({ startsAt: v })
                  }}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">End date</label>
                <input
                  type="date"
                  value={toDateInput(endsAt)}
                  onChange={e => {
                    const v = fromDateInput(e.target.value, true)
                    setEndsAt(v)
                    save({ endsAt: v })
                  }}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-foreground">{isActive ? 'Active' : 'Paused'}</p>
                <p className="text-[11px] text-foreground-muted">
                  {isActive ? 'Live and eligible to show on the homepage.' : 'Hidden everywhere until reactivated.'}
                </p>
              </div>
              <Toggle
                checked={isActive}
                disabled={!canWrite}
                onChange={next => { setIsActive(next); save({ isActive: next }) }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border-default bg-surface-secondary p-4">
            <p className="text-sm text-foreground">
              Set this offer&apos;s card image, badge and colour in{' '}
              <Link href={ap('/admin/settings/homepage')} className="font-medium text-accent-600 dark:text-accent-400 hover:underline">
                Homepage &gt; Offer Slider
              </Link>.
            </p>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
          <OfferProductPicker
            offerId={offer.id}
            canWrite={canWrite}
            categoryOptions={categoryOptions}
            brandOptions={brandOptions}
          />
        </div>
      </div>
    </div>
  )
}
