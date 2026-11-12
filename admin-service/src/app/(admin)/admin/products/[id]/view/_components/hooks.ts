'use client'

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useAgentChanges } from '@/lib/client/agent-events'
import { useActionToast } from '@/components/admin/kit'
import type { ShelfRow } from './product-view'

/** The product record; reloads when the assistant changes something. */
export function useProduct(id: string) {
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    fetch(`/api/admin/products/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(p => {
        setProduct(p)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])
  useAgentChanges(reload)

  return { product, loading, reload }
}

export function useShelfStock(id: string, enabled: boolean) {
  const [shelfStock, setShelfStock] = useState<ShelfRow[]>([])
  useEffect(() => {
    if (!enabled) return
    fetch(`/api/admin/shelving/stock?product_id=${id}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setShelfStock(d?.locations ?? []))
      .catch(() => {})
  }, [id, enabled])
  return shelfStock
}

/** Optimistic active/inactive switches for variant and sub-variant rows. */
export function useStatusToggles() {
  const { showToast } = useToast()
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (rowId: string, url: string, next: boolean) => {
    setBusy(rowId)
    setOverrides(prev => ({ ...prev, [rowId]: next }))
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update status')
      }
    } catch (err: any) {
      setOverrides(prev => ({ ...prev, [rowId]: !next }))
      showToast(err.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  return { overrides, busy, toggle }
}

// Surface a stock-assignment failure stashed by the edit form during publish
// (the publish redirected here, so the error couldn't be shown on the form).
export function useBootstrapStockNotice(id: string) {
  const toast = useActionToast()
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem('bootstrap_stock_error')
      if (msg) {
        toast.warning(`Product published, but existing stock was not assigned: ${msg} You can re-open the product edit form and assign the stock again.`)
        sessionStorage.removeItem('bootstrap_stock_error')
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
}

/** Supplier prices and purchase history, fetched the first time the card opens. */
export function useSupplierDetails(productId: string) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = () => {
    if (loaded) return
    setLoading(true)
    fetch(`/api/admin/products/${productId}/supplier-details`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
      .finally(() => setLoading(false))
  }

  return { data, loading, loaded, load }
}

export function useEnrichment(productId: string) {
  // undefined: loading · null: none
  const [item, setItem] = useState<any | null | undefined>(undefined)
  useEffect(() => {
    fetch(`/api/admin/catalog-enrichment/by-product/${productId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setItem(d.item ?? null))
      .catch(() => setItem(null))
  }, [productId])
  return [item, setItem] as const
}
