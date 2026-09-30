'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'

interface ScannedProduct {
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  sku: string
  base_price: number | null
  mrp: number | null
  inventory_quantity: number | null
  brand_name: string | null
}

const INR = (n: number | null) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n))

export default function ScanActionPopup({ role, scopes, host }: { role: string; scopes: string[]; host: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const pid = searchParams.get('scan_pid') || ''
  const vid = searchParams.get('scan_vid') || ''
  const sku = searchParams.get('scan_sku') || ''
  const active = !!(pid || sku)

  const [product, setProduct] = useState<ScannedProduct | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!active) {
      setProduct(null)
      setNotFound(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    setProduct(null)
    const params = new URLSearchParams()
    if (pid) params.set('pid', pid)
    if (vid) params.set('vid', vid)
    if (sku) params.set('sku', sku)
    fetch(`/api/admin/scan/product?${params.toString()}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.product) setProduct(d.product)
        else setNotFound(true)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, vid, sku, active])

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('scan_pid')
    params.delete('scan_vid')
    params.delete('scan_sku')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, close])

  if (!active || typeof document === 'undefined') return null

  const q = product ? new URLSearchParams({ product: product.product_id }) : new URLSearchParams()
  if (product?.variant_id) q.set('variant', product.variant_id)
  const pq = q.toString()

  const actions: { label: string; scope: string; path: string; d: string }[] = product
    ? [
        {
          label: 'New Cash Sale',
          scope: 'invoices:write',
          path: `/admin/cash-sale?${pq}`,
          d: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
        },
        {
          label: 'New Invoice',
          scope: 'invoices:write',
          path: `/admin/invoices?view=edit&${pq}`,
          d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        },
        {
          label: 'New Quotation',
          scope: 'quotations:write',
          path: `/admin/quotations?view=editor&${pq}`,
          d: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2',
        },
        {
          label: 'New PO',
          scope: 'inventory:write',
          path: `/admin/inventory/po/new?${pq}`,
          d: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
        },
        {
          label: 'Edit Product',
          scope: 'products:write',
          path: `/admin/products/edit/${product.product_id}`,
          d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
        },
        {
          label: 'View Stock',
          scope: 'inventory:read',
          path: `/admin/inventory?search=${encodeURIComponent(product.sku)}`,
          d: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
        },
      ].filter(a => hasScope(role, scopes, a.scope))
    : []

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-start justify-center p-4 sm:pt-16 bg-black/50" onClick={close}>
      <div
        className="w-full max-w-md bg-surface-elevated rounded-2xl shadow-2xl border border-border-default overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
            Scanned product
          </p>
          <button
            type="button"
            onClick={close}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <p className="text-sm text-foreground-muted text-center py-6">Loading…</p>
          ) : notFound || !product ? (
            <p className="text-sm text-foreground-muted text-center py-6">Product not found for the scanned label.</p>
          ) : (
            <>
              <h2 className="text-base font-bold text-foreground leading-tight">{product.name}</h2>
              {product.variant_name && <p className="text-sm text-foreground-secondary">{product.variant_name}</p>}
              <p className="text-xs text-foreground-muted font-mono mt-1">
                {product.sku}
                {product.brand_name ? ` · ${product.brand_name}` : ''}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-foreground-muted">Price</p>
                  <p className="text-sm font-semibold text-foreground">{INR(product.base_price)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-foreground-muted">MRP</p>
                  <p className="text-sm font-semibold text-foreground">{INR(product.mrp)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-foreground-muted">In stock</p>
                  <p className="text-sm font-semibold text-foreground">{Number(product.inventory_quantity ?? 0)}</p>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-foreground mb-2">Quick actions</p>
                {actions.length === 0 ? (
                  <p className="text-sm text-foreground-muted py-3 text-center">
                    You don&apos;t have permission for any product actions.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5">
                    {actions.map(a => (
                      <a
                        key={a.label}
                        href={ap(a.path, host)}
                        className="flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl border-2 border-border-default hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-center"
                      >
                        <svg
                          className="w-5 h-5 text-orange-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.8}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d={a.d} />
                        </svg>
                        <span className="text-[11px] font-medium text-foreground leading-tight">{a.label}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
