'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'
import AdminImage from '@/components/admin/AdminImage'
import RowActions from '@/components/admin/RowActions'

interface OfferListRow {
  id: string
  slug: string
  title: string
  image_url: string | null
  blurhash: string | null
  is_active: boolean
  product_count: number
}

export default function OffersListClient({ canWrite: canWriteProp }: { canWrite: boolean }) {
  const { showToast } = useToast()
  const router = useRouter()
  const hasWriteScope = useCanWrite('coupons:write')
  const canWrite = canWriteProp && hasWriteScope
  const [offers, setOffers] = useState<OfferListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/product-offers', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setOffers(d.offers || [])
    } catch {
      showToast('Could not load offers', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  async function addOffer() {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/product-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'New offer' }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.offer?.id) router.push(ap(`/admin/offers/${d.offer.id}/view`))
      else showToast(d.error || 'Failed to add offer', 'error')
    } catch {
      showToast('Failed to add offer', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function deleteOffer(id: string) {
    const res = await fetch(`/api/admin/product-offers/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setOffers(prev => prev.filter(o => o.id !== id))
      showToast('Offer deleted', 'success')
    } else showToast('Failed to delete', 'error')
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border-default bg-surface-secondary p-4">
        <p className="text-sm text-foreground">
          An offer groups products under a theme (e.g. a Diwali offer) with its own launch and end dates. Open an offer
          to set its title, dates and the products it holds.
        </p>
        <p className="text-xs text-foreground-muted mt-2">
          Card image, colour and badge are set under Settings &gt; Homepage &gt; Offer Slider.
        </p>
      </div>

      <div className="space-y-2">
        {loading && <p className="text-sm text-foreground-muted py-4 text-center">Loading…</p>}
        {!loading && offers.length === 0 && (
          <p className="text-sm text-foreground-muted py-4 text-center">No offers yet. Add one to get started.</p>
        )}
        {!loading &&
          offers.map(offer => (
            <div
              key={offer.id}
              className="flex items-center gap-3 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5"
            >
              <Link
                href={ap(`/admin/offers/${offer.id}/view`)}
                className="flex items-center gap-3 flex-1 min-w-0 group"
              >
                <div className="w-14 h-9 rounded-lg bg-surface-secondary border border-border-default overflow-hidden shrink-0">
                  {offer.image_url ? (
                    <AdminImage
                      src={offer.image_url}
                      alt=""
                      blurhash={offer.blurhash}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-foreground-muted/40 text-[10px]">
                      No image
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                    {offer.title || 'Untitled offer'}
                  </p>
                  <p className="text-[11px] text-foreground-muted truncate">
                    /products?offer={offer.slug} · {offer.product_count} product{offer.product_count === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${offer.is_active ? 'bg-emerald-500' : 'bg-foreground-muted/40'}`}
                title={offer.is_active ? 'Active' : 'Paused'}
              />
              {canWrite && (
                <RowActions
                  size="md"
                  className="shrink-0"
                  actions={[
                    {
                      key: 'delete',
                      kind: 'delete',
                      label: 'Delete offer',
                      onSelect: () => deleteOffer(offer.id),
                      confirm: {
                        title: 'Delete offer?',
                        message: 'This will permanently remove the offer collection. Products are not deleted.',
                        confirmLabel: 'Delete',
                        cancelLabel: 'Cancel',
                        variant: 'danger',
                      },
                    },
                  ]}
                />
              )}
            </div>
          ))}
      </div>

      <RequireWrite scope="coupons:write">
        <button
          type="button"
          onClick={addOffer}
          disabled={creating}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-border-default text-sm font-medium text-foreground-secondary hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors disabled:opacity-50"
        >
          {creating ? 'Adding…' : '+ Add offer'}
        </button>
      </RequireWrite>
    </div>
  )
}
