'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'
import { Star, Sparkles, CheckCircle, XCircle, Loader2, X, ChevronDown } from 'lucide-react'
import HoverCard from '@/components/ui/HoverCard'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import ProductStockMovements from '@/components/admin/ProductStockMovements'
import UnitsManager from '@/components/admin/UnitsManager'
import { ap } from '@/lib/admin-path'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function TagBadge({ tag, accent }: { tag: string; accent?: boolean }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${accent ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'bg-surface-secondary text-foreground-secondary'}`}>
      {tag}
    </span>
  )
}

interface EnrichmentItem {
  id: string
  product_id: string
  source_desc: string | null
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[] | null
  ai_who_uses_it: string | null
  ai_application: string | null
  ai_product_type: string | null
  ai_features: string[] | null
  ai_search_tags: string[] | null
  model: string
  status: string
  proposed_at: string
  error: string | null
}

function AiPanel({ productId, onClose, onApproved }: { productId: string; onClose: () => void; onApproved: () => void }) {
  const [item, setItem] = useState<EnrichmentItem | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/catalog-enrichment/by-product/${productId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setItem(d.item ?? null))
      .catch(() => setItem(null))
  }, [productId])

  async function decide(action: 'approve' | 'reject') {
    if (!item) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/catalog-enrichment/${item.id}/${action}`, {
        method: 'POST', credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed')
      if (action === 'approve') onApproved()
      else setItem(prev => prev ? { ...prev, status: 'rejected' } : prev)
    } finally {
      setBusy(false)
    }
  }

  const STATUS_COLOR: Record<string, string> = {
    proposed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-500" />
            <span className="font-semibold text-foreground">AI Enrichment</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-secondary text-foreground-muted hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {item === undefined && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading
            </div>
          )}

          {item === null && (
            <div className="py-12 text-center text-sm text-foreground-muted">
              No enrichment found for this product.
            </div>
          )}

          {item && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[item.status] || ''}`}>
                  {item.status}
                </span>
                <span className="text-[10px] text-foreground-muted">{item.model} · {new Date(item.proposed_at).toLocaleDateString()}</span>
              </div>

              {item.ai_product_type && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">Type</p>
                  <span className="text-xs font-medium text-accent-600 dark:text-accent-400">{item.ai_product_type}</span>
                </div>
              )}

              {item.ai_description && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">AI Description</p>
                  <p className="text-xs text-foreground leading-relaxed">{item.ai_description}</p>
                </div>
              )}

              {item.source_desc && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">Original Description</p>
                  <p className="text-xs text-foreground-muted leading-relaxed">{item.source_desc}</p>
                </div>
              )}

              {item.ai_application && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">Application</p>
                  <p className="text-xs text-foreground">{item.ai_application}</p>
                </div>
              )}

              {item.ai_who_uses_it && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">Who Uses It</p>
                  <p className="text-xs text-foreground">{item.ai_who_uses_it}</p>
                </div>
              )}

              {item.ai_use_cases?.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">Use Cases ({item.ai_use_cases.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_use_cases.map(t => <TagBadge key={t} tag={t} accent />)}
                  </div>
                </div>
              )}

              {item.ai_keywords && item.ai_keywords.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">Keywords ({item.ai_keywords.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_keywords.map(t => <TagBadge key={t} tag={t} />)}
                  </div>
                </div>
              )}

              {item.ai_features && item.ai_features.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">Features ({item.ai_features.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_features.map(t => <TagBadge key={t} tag={t} />)}
                  </div>
                </div>
              )}

              {item.ai_search_tags && item.ai_search_tags.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">Search Tags ({item.ai_search_tags.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_search_tags.map(t => <TagBadge key={t} tag={t} />)}
                  </div>
                </div>
              )}

              {item.error && (
                <div>
                  <p className="text-[10px] text-red-600 uppercase tracking-wide mb-0.5">Embed Error</p>
                  <p className="text-xs text-red-600">{item.error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {item?.status === 'proposed' && (
          <div className="px-5 py-4 border-t border-border-default flex gap-2 flex-shrink-0">
            <button
              onClick={() => decide('approve')}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded text-sm font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              onClick={() => decide('reject')}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-border-default text-foreground hover:bg-surface-secondary rounded text-sm font-semibold disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}


function Field({ label, value, mono }: { label: string; value?: any; mono?: boolean }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-foreground-secondary shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function CollapsibleCard({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">{title}</p>
        <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2.5">
          {children}
        </div>
      )}
    </div>
  )
}

function SupplierDetailsCard({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  function toggle() {
    setOpen(o => {
      if (!o && !loaded) {
        setLoading(true)
        fetch(`/api/admin/products/${productId}/supplier-details`, { credentials: 'include' })
          .then(r => r.json())
          .then(d => { setData(d); setLoaded(true) })
          .catch(() => setLoaded(true))
          .finally(() => setLoading(false))
      }
      return !o
    })
  }

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Supplier Details</p>
        <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          {loading && <p className="text-xs text-foreground-muted py-2">Loading…</p>}
          {!loading && data && (
            <div className="space-y-4">
              {/* Primary Supplier */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted mb-2">Primary Supplier</p>
                {data.primarySupplier ? (
                  <div className="bg-surface rounded-lg border border-border-default p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Link href={`/admin/suppliers/${data.primarySupplier.id}`} className="text-sm font-semibold text-accent-600 hover:underline">
                        {data.primarySupplier.name}
                      </Link>
                      {data.primarySupplier.gstin && <span className="text-xs text-foreground-muted font-mono">{data.primarySupplier.gstin}</span>}
                    </div>
                    {data.primarySupplier.contact_name && <p className="text-xs text-foreground-secondary">{data.primarySupplier.contact_name}</p>}
                    <div className="flex gap-3 text-xs text-foreground-muted">
                      {data.primarySupplier.phone && <span>{data.primarySupplier.phone}</span>}
                      {data.primarySupplier.email && <span>{data.primarySupplier.email}</span>}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-foreground-muted italic">No primary supplier set — edit product to assign one.</p>
                )}
              </div>

              {/* Last Purchase Price */}
              {data.lastPurchasePrice != null && (
                <div className="flex items-center gap-3 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-700 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-[11px] text-accent-600 dark:text-accent-400 font-medium uppercase tracking-wide">Last Purchase Price</p>
                    <p className="text-lg font-bold text-accent-700 dark:text-accent-300">
                      {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(data.lastPurchasePrice)}
                    </p>
                  </div>
                  {data.lastPurchaseDate && (
                    <p className="text-xs text-foreground-muted ml-auto">
                      {new Date(data.lastPurchaseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
              )}

              {/* Purchase History */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Purchase History</p>
                  <Link href={`/admin/inventory?tab=pos`} className="text-xs text-accent-600 hover:underline">View all POs →</Link>
                </div>
                {data.purchaseHistory?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border-default text-foreground-muted">
                          <th className="text-left pb-1.5 pr-3 font-medium">PO #</th>
                          <th className="text-left pb-1.5 pr-3 font-medium">Date</th>
                          <th className="text-left pb-1.5 pr-3 font-medium">Supplier</th>
                          <th className="text-left pb-1.5 pr-3 font-medium">Variant</th>
                          <th className="text-right pb-1.5 pr-3 font-medium">Qty</th>
                          <th className="text-right pb-1.5 pr-3 font-medium">Unit Cost</th>
                          <th className="text-right pb-1.5 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {data.purchaseHistory.map((row: any) => (
                          <tr key={`${row.po_id}-${row.variant_name}`} className="hover:bg-surface-secondary transition-colors">
                            <td className="py-1.5 pr-3 font-mono text-accent-600">
                              <Link href={`/admin/inventory?tab=pos&po=${row.po_id}`} className="hover:underline">{row.po_number}</Link>
                            </td>
                            <td className="py-1.5 pr-3 text-foreground-secondary">
                              {new Date(row.order_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-1.5 pr-3 text-foreground">{row.supplier_name}</td>
                            <td className="py-1.5 pr-3 text-foreground-muted">{row.variant_name ?? '—'}</td>
                            <td className="py-1.5 pr-3 text-right text-foreground">{row.quantity}</td>
                            <td className="py-1.5 pr-3 text-right text-foreground">
                              {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(row.unit_cost))}
                            </td>
                            <td className="py-1.5 text-right text-foreground">
                              {row.line_total_incl_gst != null
                                ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(row.line_total_incl_gst))
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-foreground-muted italic">No purchase history found for this product.</p>
                )}
              </div>
            </div>
          )}
          {!loading && loaded && !data && (
            <p className="text-xs text-foreground-muted py-2">Failed to load supplier details.</p>
          )}
        </div>
      )}
    </div>
  )
}

type ShelfRow = { location_display_code: string; quantity: number; variant_id: string | null; sub_variant_id: string | null }

function ShelfBadges({ rows }: { rows: ShelfRow[] }) {
  if (rows.length === 0) return <span className="text-xs text-foreground-muted italic">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map(l => (
        <span key={l.location_display_code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-default bg-surface-secondary text-xs">
          <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
          <span className="text-foreground-muted">·</span>
          <span className="font-semibold text-foreground">{l.quantity}</span>
        </span>
      ))}
    </div>
  )
}

export default function ProductDetailClient({ id }: { id: string }) {
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState(0)
  const [shelfStock, setShelfStock] = useState<ShelfRow[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [showDraftModal, setShowDraftModal] = useState(false)

  const loadProduct = useCallback(() => {
    setLoading(true)
    fetch(`/api/admin/products/${id}`)
      .then(r => r.json())
      .then(p => { setProduct(p); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => { loadProduct() }, [loadProduct])

  useEffect(() => {
    fetch(`/api/admin/shelving/stock?product_id=${id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setShelfStock(d?.locations ?? []))
      .catch(() => {})
  }, [id])

  if (!loading && (!product || product.error)) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-foreground-secondary">Product not found.</p>
        <Link href={ap('/admin/products')} className="text-accent-500 hover:underline text-sm">← Back to Products</Link>
      </div>
    )
  }

  if (loading || !product) {
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <div className="animate-pulse space-y-3">
          <div className="h-7 w-56 bg-surface-secondary rounded" />
          <div className="h-4 w-40 bg-surface-secondary rounded" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="h-64 bg-surface-secondary rounded-xl animate-pulse" />
          <div className="lg:col-span-2 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-4 bg-surface-secondary rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const p = product
  const images: any[] = p.product_images || []
  const variants: any[] = p.product_variants || []
  const primaryImg = images.find((i: any) => i.is_primary) || images[0]
  const displayImg = images[selectedImage] || primaryImg

  const inventoryQty = p.has_variants
    ? Number(p.variant_inventory_total || 0)
    : Number(p.inventory_quantity || 0)
  const listedQty = p.has_variants
    ? Number(p.variant_stock_total || 0)
    : (p.stock_status !== 'Out of Stock' ? 1 : 0)

  const stockColor = inventoryQty === 0
    ? 'text-red-600 dark:text-red-400'
    : p.stock_status === 'Low Stock'
    ? 'text-orange-600 dark:text-orange-400'
    : 'text-green-600 dark:text-green-400'

  function shelfFor(variantId: string | null, subVariantId: string | null) {
    return shelfStock.filter(r =>
      (variantId ? r.variant_id === variantId : r.variant_id === null) &&
      (subVariantId ? r.sub_variant_id === subVariantId : r.sub_variant_id === null)
    )
  }

  const hasVariantShelf = shelfStock.some(r => r.variant_id !== null)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap('/admin/products')} className="text-accent-500 hover:text-accent-600 transition-colors">Products</Link>
        <span>/</span>
        <span className="text-foreground truncate">{p.name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={ap('/admin/products')} className="p-1.5 text-foreground-secondary hover:text-foreground rounded-lg hover:bg-surface-secondary transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground">{p.name}</h1>
            <p className="text-xs text-foreground-muted font-mono mt-0.5">{p.sku}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.is_active
            ? <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>
            : <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-secondary text-foreground-secondary">Inactive</span>
          }
          {p.is_featured && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-current" /> Featured</span>
          )}
          <ProductWarningBadges fragile={p.fragile} hazardous={p.hazardous} flammable={p.flammable} />
          <button
            onClick={() => setAiOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors"
          >
            <Sparkles className="w-4 h-4 text-accent-500" />
            AI
          </button>
          <Link href={ap(`/admin/products/${p.id}/analytics`)} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors">
            Analytics
          </Link>
          <button
            onClick={() => setShowDraftModal(true)}
            className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
          >
            Edit
          </button>
          {showDraftModal && (
            <DraftConfirmModal
              productId={p.id}
              productName={p.name}
              productSku={p.sku || null}
              existingDraftId={null}
              backUrl={`/admin/products/${p.id}`}
              onClose={() => setShowDraftModal(false)}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          {displayImg ? (
            <div className="aspect-square rounded-xl overflow-hidden border border-border-default bg-surface-secondary">
              <img src={displayImg.image_url || displayImg.thumbnail_url} alt={p.name} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="aspect-square rounded-xl border border-border-default bg-surface-secondary flex items-center justify-center">
              <svg className="w-16 h-16 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {images.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img: any, idx: number) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(idx)}
                  className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${idx === selectedImage ? 'border-secondary-500' : 'border-border-default hover:border-border-secondary'}`}
                >
                  <img src={img.thumbnail_url || img.image_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Pricing</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'MRP', val: p.mrp },
                { label: p.has_variants ? 'From' : 'Selling Price', val: p.has_variants ? p.variant_min_price : p.base_price },
                { label: 'Ex-GST', val: p.has_variants ? null : p.price_ex_gst },
              ].map(({ label, val }) => val != null && (
                <div key={label}>
                  <p className="text-xs text-foreground-secondary mb-0.5">{label}</p>
                  <p className="text-base font-semibold text-foreground">{formatINR(Number(val))}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            {/* — Details — */}
            <CollapsibleCard title="Details">
              <Field label="Category" value={p.categories?.name} />
              <Field label="Brand" value={p.brands?.name} />
              <Field label="GST" value={p.gst_percentage != null ? `${Number(p.gst_percentage).toFixed(2)}%` : null} />
              <Field label="HSN Code" value={p.hsn_code} mono />
              <Field label="MPN" value={p.mpn} mono />
              <Field label="GTIN" value={p.gtin} mono />
              <Field label="Barcode" value={p.barcode} mono />
              <Field label="ISBN" value={p.isbn} mono />
              <Field label="ASIN" value={p.asin} mono />
              <Field label="Brand Part No." value={p.brand_part_number} mono />
              <Field label="Variant Type" value={p.variant_type} />
              <Field label="Sub-Variant Type" value={p.sub_variant_type} />
              <Field label="Condition" value={p.condition} />
              <Field label="Grade" value={p.grade} />
              <Field label="Slug" value={p.slug} mono />
            </CollapsibleCard>

            {/* — Stock & Shipping — */}
            <CollapsibleCard title="Stock & Shipping">
              <div className="flex justify-between text-sm">
                <span className="text-foreground-secondary">Inventory Stock</span>
                <span className={`font-semibold ${stockColor}`}>{inventoryQty}{p.has_variants ? ' (variants)' : ''}</span>
              </div>
              {!p.has_variants && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">Listed (Online)</span>
                  <span className="font-semibold text-foreground">{listedQty}</span>
                </div>
              )}
              <Field label="Stock Status" value={p.stock_status} />
              <Field label="Weight" value={p.weight ? `${p.weight} kg` : null} />
              <Field label="Weight (g)" value={p.weight_grams} />
              <Field label="Net Weight (g)" value={p.net_weight_grams} />
              <Field label="Volume (ml)" value={p.volume_ml} />
              <Field label="Dimensions" value={p.dimensions} />
              {(p.length_cm || p.breadth_cm || p.height_cm) && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">L × B × H</span>
                  <span className="text-foreground font-mono text-xs">{p.length_cm} × {p.breadth_cm} × {p.height_cm} cm</span>
                </div>
              )}
              <Field label="Package Type" value={p.package_type} />
              <Field label="Handling Days" value={p.handling_days} />
              <Field label="Extra Delivery Days" value={p.extra_delivery_days} />
              <Field label="Shipping Class" value={p.shipping_class} />
              {p.is_oversized && <Field label="Oversized" value="Yes" />}
              <Field label="Country of Origin" value={p.country_of_origin} />
            </CollapsibleCard>

            {/* — Pricing & Finance — */}
            <CollapsibleCard title="Pricing & Finance">
              <Field label="MRP (incl. GST)" value={p.mrp != null ? formatINR(Number(p.mrp)) : null} />
              <Field label="MRP (ex-GST)" value={p.mrp_ex_gst != null ? formatINR(Number(p.mrp_ex_gst)) : null} />
              <Field label="Selling Price" value={p.base_price != null ? formatINR(Number(p.base_price)) : null} />
              <Field label="Price (ex-GST)" value={p.price_ex_gst != null ? formatINR(Number(p.price_ex_gst)) : null} />
              <Field label="Cost Price" value={p.cost_price != null ? formatINR(Number(p.cost_price)) : null} />
              <Field label="Discount %" value={p.discount_pct != null ? `${p.discount_pct}%` : null} />
              <Field label="Tax Class" value={p.tax_class} />
              <Field label="Inclusive Tax" value={p.inclusive_tax ? 'Yes' : 'No'} />
              <Field label="COD Allowed" value={p.is_cod_allowed ? 'Yes' : 'No'} />
              {p.is_subscription && <>
                <Field label="Subscription" value="Yes" />
                <Field label="Interval" value={p.subscription_interval} />
                <Field label="Sub. Price" value={p.subscription_price != null ? formatINR(Number(p.subscription_price)) : null} />
              </>}
            </CollapsibleCard>

            {/* — Supplier Details — */}
            <SupplierDetailsCard productId={id} />

            {/* — Physical & Compliance — */}
            <CollapsibleCard title="Physical & Compliance">
              {!p.material && !p.finish && !p.size && !p.color && !p.shelf_life_days &&
               !(Array.isArray(p.certifications) && p.certifications.length) &&
               !p.compliance_standard && !p.safety_rating && !p.warranty_months &&
               !p.fragile && !p.hazardous && !p.flammable && !p.perishable && !p.serialized ? (
                <p className="text-xs text-foreground-muted italic">No physical or compliance data configured.</p>
              ) : (<>
                <Field label="Material" value={p.material} />
                <Field label="Finish" value={p.finish} />
                <Field label="Size" value={p.size} />
                <Field label="Color" value={p.color} />
                <Field label="Color Hex" value={p.color_hex} mono />
                <Field label="Shelf Life (days)" value={p.shelf_life_days} />
                <Field label="Certifications" value={Array.isArray(p.certifications) && p.certifications.length ? p.certifications.join(', ') : null} />
                <Field label="Compliance Standard" value={p.compliance_standard} />
                <Field label="Safety Rating" value={p.safety_rating} />
                <Field label="Warranty" value={p.warranty_months ? `${p.warranty_months} months${p.warranty_type ? ` (${p.warranty_type})` : ''}` : null} />
                <div className="flex flex-wrap gap-2 pt-1">
                  {p.fragile && <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">Fragile</span>}
                  {p.hazardous && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Hazardous</span>}
                  {p.flammable && <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">Flammable</span>}
                  {p.perishable && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Perishable</span>}
                  {p.serialized && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Serialized</span>}
                </div>
              </>)}
            </CollapsibleCard>

            {/* — Lifecycle & Merchandising — */}
            <CollapsibleCard title="Lifecycle & Merchandising">
              <Field label="Launch Date" value={p.launch_date ? new Date(p.launch_date).toLocaleDateString('en-IN') : null} />
              <Field label="Discontinue Date" value={p.discontinue_date ? new Date(p.discontinue_date).toLocaleDateString('en-IN') : null} />
              <Field label="Sort Order" value={p.sort_order} />
              <Field label="Views" value={p.views_count} />
              <Field label="Sales" value={p.sales_count} />
              {p.is_bundle && <Field label="Bundle" value="Yes" />}
              {p.is_digital && <>
                <Field label="Digital Product" value="Yes" />
                <Field label="Download URL" value={p.download_url} mono />
                <Field label="License Type" value={p.license_type} />
                <Field label="File Format" value={p.file_format} />
                <Field label="Platform Compat." value={Array.isArray(p.platform_compatibility) && p.platform_compatibility.length ? p.platform_compatibility.join(', ') : null} />
              </>}
            </CollapsibleCard>

            {/* — SEO & Audience — */}
            <CollapsibleCard title="SEO & Audience">
              <Field label="Meta Title" value={p.meta_title} />
              <Field label="Meta Description" value={p.meta_description} />
              <Field label="Searchable" value={p.is_searchable ? 'Yes' : 'No'} />
              <Field label="Target Gender" value={p.target_gender} />
              <Field label="Target Audience" value={Array.isArray(p.target_audience) && p.target_audience.length ? p.target_audience.join(', ') : null} />
              <Field label="Age Range" value={(p.age_min != null || p.age_max != null) ? `${p.age_min ?? '—'} – ${p.age_max ?? '—'}` : null} />
            </CollapsibleCard>
          </div>

          {/* — Specifications — */}
          {p.specifications && Object.keys(p.specifications).length > 0 && (
            <CollapsibleCard title="Specifications">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                {Object.entries(p.specifications).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm border-b border-border-default/40 pb-1">
                    <span className="text-foreground-secondary">{k}</span>
                    <span className="text-foreground font-mono text-xs">{String(v)}</span>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          )}

          {/* — Short Description — */}
          {p.short_description && (
            <CollapsibleCard title="Short Description">
              <p className="text-sm text-foreground leading-relaxed">{p.short_description}</p>
            </CollapsibleCard>
          )}

          {p.description && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Description</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{p.description}</p>
            </div>
          )}

          {(p.ai_description || p.ai_product_type || p.ai_use_cases?.length || p.ai_keywords?.length || p.ai_features?.length || p.ai_search_tags?.length || p.ai_who_uses_it || p.ai_application) && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-3">AI Intelligence</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {p.ai_product_type && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-0.5">Type</p>
                    <span className="text-xs font-medium text-accent-600 dark:text-accent-400">{p.ai_product_type}</span>
                  </div>
                )}
                {p.ai_description && (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">AI Description</p>
                    <p className="text-xs text-foreground leading-relaxed">{p.ai_description}</p>
                  </div>
                )}
                {p.ai_application && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">Application</p>
                    <p className="text-xs text-foreground">{p.ai_application}</p>
                  </div>
                )}
                {p.ai_who_uses_it && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">Who Uses It</p>
                    <p className="text-xs text-foreground">{p.ai_who_uses_it}</p>
                  </div>
                )}
                {p.ai_use_cases?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">Use Cases ({p.ai_use_cases.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_use_cases.map((t: string) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {p.ai_keywords?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">Keywords ({p.ai_keywords.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_keywords.map((t: string) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-surface-secondary text-foreground-secondary rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {p.ai_features?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">Features ({p.ai_features.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_features.map((t: string) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-surface-secondary text-foreground-secondary rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {p.ai_search_tags?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">Search Tags ({p.ai_search_tags.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_search_tags.map((t: string) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-surface-secondary text-foreground-secondary rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* — Selling Units & Shelf Locations — */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <CollapsibleCard title="Selling Units">
              <UnitsManager productId={p.id} basePrice={p.base_price} readOnly />
            </CollapsibleCard>
            {shelfStock.length > 0 && (
              <CollapsibleCard title="Shelf Locations">
                <ShelfBadges rows={shelfStock} />
              </CollapsibleCard>
            )}
          </div>

          <div className="flex gap-4 text-xs text-foreground-muted">
            <span>Created {formatDate(p.created_at)}</span>
            <span>Updated {formatDate(p.updated_at)}</span>
          </div>
        </div>
      </div>

      {p.has_variants && variants.length > 0 && (
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="px-4 py-3 border-b border-border-default">
            <p className="text-sm font-semibold text-foreground">Variants ({variants.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Variant</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden sm:table-cell">SKU</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Price (incl. GST)</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden md:table-cell">Ex-GST</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden md:table-cell">MRP</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Inventory</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden lg:table-cell">Stock Status</th>
                  {hasVariantShelf && (
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden xl:table-cell">Shelf</th>
                  )}
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {variants.map((v: any) => {
                  const subVariants: any[] = v.sub_variants || []
                  const hasSubs = subVariants.length > 0
                  const vInventory = hasSubs ? Number(v.sub_variant_inventory_total || 0) : Number(v.inventory_quantity || 0)
                  const vListed = hasSubs ? (v.stock_status || '—') : (v.stock_status || '—')
                  const vStockColor = vInventory === 0 ? 'text-red-600 dark:text-red-400' : v.stock_status === 'Low Stock' ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'
                  const vMinPrice = hasSubs ? Number(v.sub_variant_min_price || 0) : Number(v.price || 0)
                  const vShelf = hasSubs ? [] : shelfFor(v.id, null)
                  return (
                    <React.Fragment key={v.id}>
                    <tr className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {hasSubs ? (
                          <HoverCard
                            trigger={
                              <span className="cursor-help">
                                {v.variant_name}
                                <span className="ml-2 text-xs font-normal text-foreground-muted underline decoration-dotted">({subVariants.length} sub-variants)</span>
                              </span>
                            }
                            align="left"
                            side="bottom"
                            width="360px"
                          >
                            <div className="p-3 space-y-2">
                              <p className="text-sm font-semibold text-foreground">{v.variant_name}</p>
                              <div className="border-t border-border-default pt-2 space-y-2">
                                {subVariants.map((sv: any) => {
                                  const svShelf = shelfFor(v.id, sv.id)
                                  return (
                                    <div key={sv.id} className="space-y-1">
                                      <div className="flex items-center justify-between gap-3 text-xs">
                                        <div className="flex flex-col min-w-0">
                                          <span className="font-medium text-foreground truncate">{sv.sub_variant_name}</span>
                                          {sv.sku && <span className="font-mono text-foreground-muted text-[10px]">{sv.sku}</span>}
                                        </div>
                                        <div className="flex items-center gap-3 text-right shrink-0">
                                          <span className="text-foreground-secondary">{sv.price ? formatINR(Number(sv.price)) : '—'}</span>
                                          <span className={`font-medium ${Number(sv.inventory_quantity || 0) === 0 ? 'text-red-600' : Number(sv.inventory_quantity || 0) <= 3 ? 'text-orange-600' : 'text-foreground'}`}>
                                            Inv: {Number(sv.inventory_quantity || 0)}
                                          </span>
                                          <span className="text-foreground-muted">
                                            Listed: {sv.stock_status || '—'}
                                          </span>
                                        </div>
                                      </div>
                                      {svShelf.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pl-1">
                                          {svShelf.map(l => (
                                            <span key={l.location_display_code} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-default bg-surface-secondary text-[10px]">
                                              <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
                                              <span className="text-foreground-muted">·</span>
                                              <span className="font-semibold text-foreground">{l.quantity}</span>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </HoverCard>
                        ) : (
                          v.variant_name
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell">{v.sku || '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground">{vMinPrice > 0 ? (hasSubs ? `From ${formatINR(vMinPrice)}` : formatINR(vMinPrice)) : '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground-secondary hidden md:table-cell">{!hasSubs && v.price_ex_gst ? formatINR(Number(v.price_ex_gst)) : '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground-secondary hidden md:table-cell">{!hasSubs && v.mrp ? formatINR(Number(v.mrp)) : '—'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${vStockColor}`}>{vInventory}</td>
                      <td className="px-4 py-3 text-right text-foreground-muted hidden lg:table-cell">{vListed}</td>
                      {hasVariantShelf && (
                        <td className="px-4 py-3 hidden xl:table-cell">
                          {hasSubs
                            ? <span className="text-xs text-foreground-muted italic">see sub-variants</span>
                            : <ShelfBadges rows={vShelf} />
                          }
                        </td>
                      )}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${(!p.is_active || !v.is_active) ? 'bg-surface-secondary text-foreground-secondary' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                          {(!p.is_active || !v.is_active) ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                    </tr>
                    {hasSubs && subVariants.map((sv: any) => {
                      const svInventory = Number(sv.inventory_quantity || 0)
                      const svListed = sv.stock_status || '—'
                      const svStockColor = svInventory === 0 ? 'text-red-600 dark:text-red-400' : svInventory <= 3 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'
                      const svShelf = shelfFor(v.id, sv.id)
                      return (
                        <tr key={sv.id} className="bg-surface-secondary/30 hover:bg-surface-secondary/50 transition-colors">
                          <td className="px-4 py-2 pl-10 text-sm text-foreground-secondary">↳ {sv.sub_variant_name}</td>
                          <td className="px-4 py-2 font-mono text-xs text-foreground-muted hidden sm:table-cell">{sv.sku || '—'}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground">{sv.price ? formatINR(Number(sv.price)) : '—'}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground-secondary hidden md:table-cell">{sv.price_ex_gst ? formatINR(Number(sv.price_ex_gst)) : '—'}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground-secondary hidden md:table-cell">{sv.mrp ? formatINR(Number(sv.mrp)) : '—'}</td>
                          <td className={`px-4 py-2 text-right text-sm font-medium ${svStockColor}`}>{svInventory}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground-muted hidden lg:table-cell">{svListed}</td>
                          {hasVariantShelf && (
                            <td className="px-4 py-2 hidden xl:table-cell">
                              <ShelfBadges rows={svShelf} />
                            </td>
                          )}
                          <td className="px-4 py-2 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${(!p.is_active || !v.is_active || !sv.is_active) ? 'bg-surface-secondary text-foreground-secondary' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                              {(!p.is_active || !v.is_active || !sv.is_active) ? 'Inactive' : 'Active'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aiOpen && (
        <AiPanel
          productId={id}
          onClose={() => setAiOpen(false)}
          onApproved={() => { setAiOpen(false); loadProduct() }}
        />
      )}

      <ProductStockMovements productId={id} />
    </div>
  )
}
