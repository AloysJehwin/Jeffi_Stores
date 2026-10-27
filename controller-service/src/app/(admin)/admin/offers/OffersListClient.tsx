'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'
import AdminImage from '@/components/admin/AdminImage'
import { Plus } from 'lucide-react'
import { DataTable, DraftLockBadge, StatusBadge, useListSort, type DataCol } from '@/components/admin/kit'
import type { DraftLockChip } from '@/lib/client/draft-lock-client'

interface OfferListRow {
  id: string
  slug: string
  title: string
  image_url: string | null
  blurhash: string | null
  is_active: boolean
  product_count: number
  draft_lock?: DraftLockChip | null
}

export default function OffersListClient({ canWrite: canWriteProp }: { canWrite: boolean }) {
  const { showToast } = useToast()
  const router = useRouter()
  const hasWriteScope = useCanWrite('coupons:write')
  const canWrite = canWriteProp && hasWriteScope
  const [offers, setOffers] = useState<OfferListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const { sort, dir } = useListSort()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = sort ? `?${new URLSearchParams({ sort, dir })}` : ''
      const res = await fetch(`/api/admin/product-offers${qs}`, { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setOffers(d.offers || [])
    } catch {
      showToast('Could not load offers', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast, sort, dir])

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

  const cols: DataCol<OfferListRow>[] = [
    {
      key: 'title',
      label: 'Offer',
      sortParam: 'title',
      render: offer => (
        <Link href={ap(`/admin/offers/${offer.id}/view`)} className="flex items-center gap-3 min-w-0 group" onClick={e => e.stopPropagation()}>
          <div className="w-14 h-9 rounded-lg bg-surface-secondary border border-border-default overflow-hidden shrink-0">
            {offer.image_url ? (
              <AdminImage src={offer.image_url} alt="" blurhash={offer.blurhash} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-foreground-muted text-[10px]">No image</div>
            )}
          </div>
          <span className="min-w-0 truncate font-semibold text-foreground group-hover:text-accent-500 transition-colors">{offer.title || 'Untitled offer'}</span>
          <DraftLockBadge lock={offer.draft_lock} mine={offer.draft_lock?.mine} />
        </Link>
      ),
    },
    { key: 'slug', label: 'Link', hideBelow: 'lg', sortParam: 'slug', render: offer => <span className="font-mono text-xs text-foreground-muted">/products?offer={offer.slug}</span> },
    { key: 'products', label: 'Products', num: true, sortParam: 'products', render: offer => offer.product_count },
    {
      key: 'status',
      label: 'Status',
      sortParam: 'status',
      render: offer => <StatusBadge status={String(offer.is_active)} map={{ true: { label: 'Active', tone: 'green' }, false: { label: 'Paused', tone: 'muted' } }} />,
    },
  ]

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border-default bg-surface-elevated p-4">
        <p className="text-sm text-foreground">
          An offer groups products under a theme (e.g. a Diwali offer) with its own launch and end dates. Open an offer
          to set its title, dates and the products it holds.
        </p>
        <p className="text-xs text-foreground-muted mt-2">
          Card image, colour and badge are set under Settings &gt; Homepage &gt; Offer Slider.
        </p>
      </div>

      <DataTable<OfferListRow>
        rows={offers}
        cols={cols}
        rowKey={o => o.id}
        loading={loading}
        search={{ placeholder: 'Search offers...', match: o => `${o.title} ${o.slug}` }}
        toolbar={
          <RequireWrite scope="coupons:write">
            <button type="button" onClick={addOffer} disabled={creating} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
              <Plus className="w-4 h-4" />
              {creating ? 'Adding…' : 'Add offer'}
            </button>
          </RequireWrite>
        }
        onRowClick={o => router.push(ap(`/admin/offers/${o.id}/view`))}
        mobileCard={offer => (
          <Link href={ap(`/admin/offers/${offer.id}/view`)} className="flex items-center gap-3 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5">
            <div className="w-14 h-9 rounded-lg bg-surface-secondary border border-border-default overflow-hidden shrink-0">
              {offer.image_url ? (
                <AdminImage src={offer.image_url} alt="" blurhash={offer.blurhash} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-foreground-muted text-[10px]">No image</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">{offer.title || 'Untitled offer'}</p>
              <p className="text-[11px] text-foreground-muted truncate">
                {offer.product_count} product{offer.product_count === 1 ? '' : 's'}
              </p>
            </div>
            <DraftLockBadge lock={offer.draft_lock} mine={offer.draft_lock?.mine} />
            <StatusBadge status={String(offer.is_active)} map={{ true: { label: 'Active', tone: 'green' }, false: { label: 'Paused', tone: 'muted' } }} />
          </Link>
        )}
        empty={{ title: 'No offers yet.', body: 'Add one to get started.' }}
        rowActions={offer => [
          {
            key: 'delete',
            kind: 'delete',
            label: 'Delete offer',
            hidden: !canWrite,
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
    </div>
  )
}
