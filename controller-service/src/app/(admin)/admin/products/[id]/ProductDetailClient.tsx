'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'
import { Star, Sparkles, CheckCircle, XCircle, Loader2, X, ChevronDown } from 'lucide-react'
import HoverCard from '@/components/ui/HoverCard'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import ProductStockMovements from '@/components/admin/ProductStockMovements'
import UnitsManager from '@/components/admin/UnitsManager'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'
import { RequireWrite, useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { Dialog, DetailHeader, DetailSkeleton, ErrorState, ViewDraftLink, badgeCls, useActionToast } from '@/components/admin/kit'
import { formatINR, formatDate } from '@/lib/shared/format'
import {
  deriveSellableItems,
  monthlyEquivalentLabel,
  pickSubscriptionPrice,
  subscriptionSavingsPct,
} from '@/lib/subscriptions/sellable'
import { SUBSCRIPTION_INTERVALS, SUBSCRIPTION_INTERVAL_LABELS, isSubscriptionInterval } from '@/lib/subscriptions/intervals'

function TagBadge({ tag, accent }: { tag: string; accent?: boolean }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded ${accent ? 'bg-accent-500/5 text-accent-500' : 'bg-surface-secondary text-foreground-secondary'}`}
    >
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

function AiPanel({
  productId,
  onClose,
  onApproved,
}: {
  productId: string
  onClose: () => void
  onApproved: () => void
}) {
  const [item, setItem] = useState<EnrichmentItem | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()

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
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        toast.error(`Failed to ${action} enrichment`)
        throw new Error('Failed')
      }
      toast.success(action === 'approve' ? 'Enrichment approved' : 'Enrichment rejected')
      if (action === 'approve') onApproved()
      else setItem(prev => (prev ? { ...prev, status: 'rejected' } : prev))
    } finally {
      setBusy(false)
    }
  }

  const STATUS_TONE: Record<string, 'amber' | 'green' | 'red'> = { proposed: 'amber', approved: 'green', rejected: 'red' }

  return (
    <Dialog
      open
      onClose={onClose}
      zIndex="z-[400]"
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-500" />
          AI Enrichment
        </span>
      }
      footer={
        item?.status === 'proposed' ? (
          <RequireWrite scope="products:write">
            <div className="flex w-full gap-2">
              <button
                onClick={() => decide('approve')}
                disabled={busy}
                className="control-md flex-1 bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Approve
              </button>
              <button
                onClick={() => decide('reject')}
                disabled={busy}
                className="control-md flex-1 border border-border-default text-foreground hover:bg-surface-secondary font-semibold disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          </RequireWrite>
        ) : undefined
      }
    >
          {item === undefined && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading
            </div>
          )}

          {item === null && (
            <div className="py-12 text-center text-sm text-foreground-muted">No enrichment found for this product.</div>
          )}

          {item && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span
                  className={badgeCls(STATUS_TONE[item.status] ?? 'muted')}
                >
                  {item.status}
                </span>
                <span className="text-[10px] text-foreground-muted">
                  {item.model} · {new Date(item.proposed_at).toLocaleDateString()}
                </span>
              </div>

              {item.ai_product_type && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">Type</p>
                  <span className="text-xs font-medium text-accent-500">
                    {item.ai_product_type}
                  </span>
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
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-0.5">
                    Original Description
                  </p>
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
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">
                    Use Cases ({item.ai_use_cases.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_use_cases.map(t => (
                      <TagBadge key={t} tag={t} accent />
                    ))}
                  </div>
                </div>
              )}

              {item.ai_keywords && item.ai_keywords.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">
                    Keywords ({item.ai_keywords.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_keywords.map(t => (
                      <TagBadge key={t} tag={t} />
                    ))}
                  </div>
                </div>
              )}

              {item.ai_features && item.ai_features.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">
                    Features ({item.ai_features.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_features.map(t => (
                      <TagBadge key={t} tag={t} />
                    ))}
                  </div>
                </div>
              )}

              {item.ai_search_tags && item.ai_search_tags.length > 0 && (
                <div>
                  <p className="text-[10px] text-foreground-muted uppercase tracking-wide mb-1">
                    Search Tags ({item.ai_search_tags.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {item.ai_search_tags.map(t => (
                      <TagBadge key={t} tag={t} />
                    ))}
                  </div>
                </div>
              )}

              {item.error && (
                <div>
                  <p className="text-[10px] text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">Embed Error</p>
                  <p className="text-xs text-red-600 dark:text-red-400">{item.error}</p>
                </div>
              )}
            </div>
          )}
    </Dialog>
  )
}

function Field({ label, value, mono }: { label: string; value?: any; mono?: boolean }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-foreground-secondary shrink-0">{label}</span>
      <span className={`min-w-0 break-words text-foreground text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

// Sub-variants belong to a variant only while its "Has sub-variants" is on (an active
// sub-variant also counts: rows added outside a publish do not set the flag). Rows left
// behind by a turned-off toggle are not shown.
function variantSubsShown(v: any): any[] {
  const subs: any[] = Array.isArray(v?.sub_variants) ? v.sub_variants : []
  return v?.sub_variant_type_on || subs.some(sv => sv?.is_active !== false) ? subs : []
}

function SubscriptionDetails({ p, variants }: { p: any; variants: any[] }) {
  const intervals: string[] = Array.isArray(p.subscription_intervals) ? p.subscription_intervals : []
  const offered = SUBSCRIPTION_INTERVALS.filter(i => intervals.includes(i))
  const subsByVariant: Record<string, any[]> = {}
  for (const v of variants) subsByVariant[String(v.id)] = variantSubsShown(v)
  const items = deriveSellableItems({
    hasVariants: !!p.has_variants,
    product: {
      name: p.name,
      sku: p.sku,
      price: p.base_price,
      subscription_price: p.subscription_price,
      subscription_prices: p.subscription_prices,
    },
    variants: variants.map(v => ({
      ...v,
      sub_variant_type_on: variantSubsShown(v).length > 0,
    })),
    subVariantsByVariant: subsByVariant,
  })
  return (
    <>
      <Field
        label="Billing Intervals"
        value={intervals.map(i => (isSubscriptionInterval(i) ? SUBSCRIPTION_INTERVAL_LABELS[i] : i)).join(', ') || '—'}
      />
      <Field label="Billing Cycles" value={p.subscription_total_cycles ?? 'Until cancelled'} />
      <Field label="Minimum Billing Cycles" value={p.subscription_min_cycles ?? '—'} />
      <div className="overflow-x-auto pt-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-foreground-secondary">
              <th className="py-1.5 pr-2 text-left font-semibold">Item</th>
              <th className="py-1.5 px-2 text-right font-semibold">One-time</th>
              {offered.map(iv => (
                <th key={iv} className="py-1.5 px-2 text-right font-semibold">
                  {SUBSCRIPTION_INTERVAL_LABELS[iv]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {items.map(it => {
              return (
                <tr key={it.key}>
                  <td className="py-1.5 pr-2 text-foreground">
                    {it.name}
                    {it.sku && <span className="block font-mono text-[10px] text-foreground-muted">{it.sku}</span>}
                  </td>
                  <td className="py-1.5 px-2 text-right text-foreground">
                    {it.oneTimePrice != null ? formatINR(it.oneTimePrice) : '—'}
                  </td>
                  {offered.map(iv => {
                    const sub = pickSubscriptionPrice(it.subscriptionPrices, it.subscriptionPrice, iv)
                    const pct = sub != null && it.oneTimePrice != null ? subscriptionSavingsPct(it.oneTimePrice, sub) : 0
                    const perMonth = sub != null ? monthlyEquivalentLabel(iv, sub) : null
                    return (
                      <td key={iv} className="py-1.5 px-2 text-right text-foreground" data-testid={`sub-price-${iv}`}>
                        {sub != null ? formatINR(sub) : <span className="text-foreground-muted">Same as one-time</span>}
                        {(perMonth || pct > 0) && (
                          <span className="block text-[10px] text-foreground-muted">
                            {[perMonth, pct > 0 ? `${pct}% off` : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
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
        <p className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</p>
        <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-2.5">{children}</div>}
    </div>
  )
}

function SupplierDetailsCard({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [poPage, setPoPage] = useState(0)
  const PO_PAGE_SIZE = 5

  function toggle() {
    setOpen(o => {
      if (!o && !loaded) {
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
      return !o
    })
  }

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-secondary transition-colors focus:outline-none"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-foreground">Supplier Details</p>
        <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          {loading && <p className="text-xs text-foreground-muted py-2">Loading…</p>}
          {!loading && data && (
            <div className="space-y-4">
              {/* Primary Supplier */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                  Primary Supplier
                </p>
                {data.primarySupplier ? (
                  <div className="bg-surface rounded-lg border border-border-default p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/admin/suppliers/${data.primarySupplier.id}/view`}
                        className="text-sm font-semibold text-accent-600 hover:underline"
                      >
                        {data.primarySupplier.name}
                      </Link>
                      {data.primarySupplier.gstin && (
                        <span className="text-xs text-foreground-muted font-mono">{data.primarySupplier.gstin}</span>
                      )}
                    </div>
                    {data.primarySupplier.contact_name && (
                      <p className="text-xs text-foreground-secondary">{data.primarySupplier.contact_name}</p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-muted">
                      {data.primarySupplier.phone && <span>{data.primarySupplier.phone}</span>}
                      {data.primarySupplier.email && <span className="min-w-0 [overflow-wrap:anywhere]">{data.primarySupplier.email}</span>}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-foreground-muted italic">
                    No primary supplier set — edit product to assign one.
                  </p>
                )}
              </div>

              {/* Suppliers by price — grouped per leaf (product / variant / sub-variant) */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                  Suppliers (by price)
                </p>
                {data.suppliers?.length > 0 ? (
                  <div className="space-y-4">
                    {(() => {
                      const NIL = '00000000-0000-0000-0000-000000000000'
                      const bestByLeaf: Record<string, string> = data.bestByLeaf || {}
                      // Group suppliers by leaf, preserving the price-ascending order the API returns.
                      const groups = new Map<string, { label: string; rows: any[] }>()
                      for (const row of data.suppliers as any[]) {
                        const key = `${row.variant_id || NIL}:${row.sub_variant_id || NIL}`
                        let g = groups.get(key)
                        if (!g) {
                          const label = row.sub_variant_id
                            ? `Sub-variant: ${row.sub_variant_name || row.sub_variant_id}`
                            : row.variant_id
                              ? `Variant: ${row.variant_name || row.variant_id}`
                              : 'Product'
                          g = { label, rows: [] }
                          groups.set(key, g)
                        }
                        g.rows.push(row)
                      }
                      return Array.from(groups.entries()).map(([leafKey, g]) => {
                        const fmt = (v: number) =>
                          new Intl.NumberFormat('en-IN', {
                            style: 'currency',
                            currency: 'INR',
                            maximumFractionDigits: 2,
                          }).format(v)
                        const leafLowest = data.lowestHistByLeaf?.[leafKey]
                        const leafLast = data.lastPurchaseByLeaf?.[leafKey]
                        return (
                          <div key={leafKey} className="space-y-2">
                            <p className="text-[11px] font-medium text-foreground-secondary mb-1">{g.label}</p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border-default text-foreground-muted">
                                    <th className="text-left pb-1.5 pr-3 font-medium">Supplier</th>
                                    <th className="text-right pb-1.5 pr-3 font-medium">Buy Price</th>
                                    <th className="text-center pb-1.5 pr-3 font-medium">Preferred</th>
                                    <th className="text-right pb-1.5 pr-3 font-medium">MOQ</th>
                                    <th className="text-right pb-1.5 font-medium">Lead (days)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border-default">
                                  {g.rows.map((row: any) => {
                                    const isBest = row.supplier_id === bestByLeaf[leafKey]
                                    return (
                                      <tr
                                        key={row.id}
                                        className={
                                          isBest
                                            ? 'bg-accent-500/5'
                                            : 'hover:bg-surface-secondary transition-colors'
                                        }
                                      >
                                        <td className="py-1.5 pr-3">
                                          <Link
                                            href={`/admin/suppliers/${row.supplier_id}/view`}
                                            className="text-accent-600 hover:underline"
                                          >
                                            {row.supplier_name}
                                          </Link>
                                          {isBest && (
                                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-accent-500">
                                              Best
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-1.5 pr-3 text-right font-semibold text-foreground">
                                          {new Intl.NumberFormat('en-IN', {
                                            style: 'currency',
                                            currency: 'INR',
                                            maximumFractionDigits: 2,
                                          }).format(Number(row.unit_cost))}
                                        </td>
                                        <td className="py-1.5 pr-3 text-center">{row.is_preferred ? '★' : '—'}</td>
                                        <td className="py-1.5 pr-3 text-right text-foreground-muted">
                                          {row.moq ?? '—'}
                                        </td>
                                        <td className="py-1.5 text-right text-foreground-muted">
                                          {row.lead_time_days ?? '—'}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {(leafLowest != null || leafLast) && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {leafLowest != null && (
                                  <div className="flex-1 min-w-[130px] bg-surface border border-border-default rounded-lg px-3 py-2">
                                    <p className="text-[10px] text-foreground-muted font-medium uppercase tracking-wide">
                                      Lowest ever paid (PO)
                                    </p>
                                    <p className="text-sm font-bold text-foreground">{fmt(leafLowest)}</p>
                                  </div>
                                )}
                                {leafLast && (
                                  <div className="flex-1 min-w-[130px] bg-accent-500/5 border border-accent-500/30 rounded-lg px-3 py-2">
                                    <p className="text-[10px] text-accent-500 font-medium uppercase tracking-wide">
                                      Last Purchase Price
                                    </p>
                                    <p className="text-sm font-bold text-accent-500">
                                      {fmt(leafLast.price)}
                                    </p>
                                    <p className="text-[10px] text-foreground-muted">
                                      {new Date(leafLast.date).toLocaleDateString('en-IN', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      })}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    })()}
                  </div>
                ) : (
                  <p className="text-xs text-foreground-muted italic">
                    No suppliers linked — edit product to add suppliers &amp; prices.
                  </p>
                )}
              </div>

              {/* Purchase History */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                    Purchase History
                  </p>
                  <Link href={`/admin/purchase-orders?tab=orders`} className="text-xs text-accent-600 hover:underline">
                    View all POs →
                  </Link>
                </div>
                {data.purchaseHistory?.length > 0 ? (
                  <div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border-default text-foreground-muted">
                            <th className="text-left pb-1.5 pr-3 font-medium">PO #</th>
                            <th className="text-left pb-1.5 pr-3 font-medium">Date</th>
                            <th className="text-left pb-1.5 pr-3 font-medium">Supplier</th>
                            <th className="text-left pb-1.5 pr-3 font-medium">SKU</th>
                            <th className="text-right pb-1.5 pr-3 font-medium">Qty</th>
                            <th className="text-right pb-1.5 pr-3 font-medium">Unit Cost</th>
                            <th className="text-right pb-1.5 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {data.purchaseHistory
                            .slice(poPage * PO_PAGE_SIZE, (poPage + 1) * PO_PAGE_SIZE)
                            .map((row: any, idx: number) => (
                              <tr
                                key={`${row.po_id}-${poPage}-${idx}`}
                                className="hover:bg-surface-secondary transition-colors"
                              >
                                <td className="py-1.5 pr-3 font-mono text-accent-600">
                                  <Link href={`/admin/purchase-orders?tab=orders&po=${row.po_id}`} className="hover:underline">
                                    {row.po_number}
                                  </Link>
                                </td>
                                <td className="py-1.5 pr-3 text-foreground-secondary">
                                  {new Date(row.order_date).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </td>
                                <td className="py-1.5 pr-3 text-foreground">{row.supplier_name}</td>
                                <td className="py-1.5 pr-3 text-foreground-muted">
                                  {row.sku ? (
                                    <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground">
                                      {row.sku}
                                      <CopySku sku={row.sku} />
                                    </span>
                                  ) : row.sub_variant_name ? (
                                    <span>
                                      {row.variant_name ? `${row.variant_name} — ` : ''}
                                      {row.sub_variant_name}
                                    </span>
                                  ) : (
                                    row.variant_name || '—'
                                  )}
                                </td>
                                <td className="py-1.5 pr-3 text-right text-foreground">{row.quantity}</td>
                                <td className="py-1.5 pr-3 text-right text-foreground">
                                  {new Intl.NumberFormat('en-IN', {
                                    style: 'currency',
                                    currency: 'INR',
                                    maximumFractionDigits: 2,
                                  }).format(Number(row.unit_cost))}
                                </td>
                                <td className="py-1.5 text-right text-foreground">
                                  {row.line_total_incl_gst != null
                                    ? new Intl.NumberFormat('en-IN', {
                                        style: 'currency',
                                        currency: 'INR',
                                        maximumFractionDigits: 2,
                                      }).format(Number(row.line_total_incl_gst))
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {data.purchaseHistory.length > PO_PAGE_SIZE && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-default">
                        <span className="text-[11px] text-foreground-muted">
                          {poPage * PO_PAGE_SIZE + 1}–
                          {Math.min((poPage + 1) * PO_PAGE_SIZE, data.purchaseHistory.length)} of{' '}
                          {data.purchaseHistory.length}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setPoPage(p => p - 1)}
                            disabled={poPage === 0}
                            className="px-2 py-0.5 text-xs rounded border border-border-default disabled:opacity-30 hover:bg-surface-secondary transition-colors"
                          >
                            ‹ Prev
                          </button>
                          <button
                            onClick={() => setPoPage(p => p + 1)}
                            disabled={(poPage + 1) * PO_PAGE_SIZE >= data.purchaseHistory.length}
                            className="px-2 py-0.5 text-xs rounded border border-border-default disabled:opacity-30 hover:bg-surface-secondary transition-colors"
                          >
                            Next ›
                          </button>
                        </div>
                      </div>
                    )}
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

type ShelfRow = {
  location_display_code: string
  quantity: number
  variant_id: string | null
  sub_variant_id: string | null
}

function ShelfBadges({ rows }: { rows: ShelfRow[] }) {
  if (rows.length === 0) return <span className="text-xs text-foreground-muted italic">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map(l => (
        <span
          key={l.location_display_code}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-default bg-surface-secondary text-xs"
        >
          <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
          <span className="text-foreground-muted">·</span>
          <span className="font-semibold text-foreground">{l.quantity}</span>
        </span>
      ))}
    </div>
  )
}

function StatusToggle({
  active,
  blockedBy,
  canWrite,
  busy,
  onToggle,
}: {
  active: boolean
  blockedBy: string | null
  canWrite: boolean
  busy: boolean
  onToggle: () => void
}) {
  const shownActive = active && !blockedBy
  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={() => canWrite && !busy && onToggle()}
        disabled={!canWrite || busy}
        title={
          blockedBy
            ? `Set to ${active ? 'Active' : 'Inactive'}, but hidden because the ${blockedBy} is inactive`
            : undefined
        }
        className={`${badgeCls(shownActive ? 'green' : 'muted')} transition-opacity ${canWrite ? 'hover:opacity-75 cursor-pointer' : 'cursor-default'} ${busy ? 'opacity-50' : ''}`}
      >
        {shownActive ? 'Active' : 'Inactive'}
      </button>
      {blockedBy && active && <span className="text-[10px] text-foreground-muted">{blockedBy} inactive</span>}
    </div>
  )
}

export default function ProductDetailClient({
  id,
  hasInventory = true,
  heldDraft,
}: {
  id: string
  hasInventory?: boolean
  /** Another admin holds the draft: open it read-only instead of starting one. */
  heldDraft?: { ownerName: string; href: string } | null
}) {
  const [product, setProduct] = useState<any>(null)
  const canWriteProducts = useCanWrite('products')
  const canEnrich = useHasScope('catalog_enrichment:read')
  const canShelving = useHasScope('shelving:read')
  const { showToast } = useToast()
  const [statusOverrides, setStatusOverrides] = useState<Record<string, boolean>>({})
  const [statusBusy, setStatusBusy] = useState<string | null>(null)

  const toggleStatus = async (rowId: string, url: string, next: boolean) => {
    setStatusBusy(rowId)
    setStatusOverrides(prev => ({ ...prev, [rowId]: next }))
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
      setStatusOverrides(prev => ({ ...prev, [rowId]: !next }))
      showToast(err.message, 'error')
    } finally {
      setStatusBusy(null)
    }
  }
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState(0)
  const [shelfStock, setShelfStock] = useState<ShelfRow[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [showDraftModal, setShowDraftModal] = useState(false)
  // Surface a stock-assignment failure stashed by the edit form during publish
  // (the publish redirected here, so the error couldn't be shown on the form).
  const toast = useActionToast()
  const setBootstrapStockError = useCallback(
    (msg: string) =>
      toast.warning(`Product published, but existing stock was not assigned: ${msg} You can re-open the product edit form and assign the stock again.`),
    [toast]
  )
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem('bootstrap_stock_error')
      if (msg) {
        setBootstrapStockError(msg)
        sessionStorage.removeItem('bootstrap_stock_error')
      }
    } catch {
      /* ignore */
    }
  }, [id])

  const loadProduct = useCallback(() => {
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
    loadProduct()
  }, [loadProduct])

  useEffect(() => {
    if (!canShelving) return
    fetch(`/api/admin/shelving/stock?product_id=${id}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setShelfStock(d?.locations ?? []))
      .catch(() => {})
  }, [id, canShelving])

  if (!loading && (!product || product.error)) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title="Product not found." actionNode={<Link href={ap('/admin/products')} className="text-sm text-accent-500 hover:underline">Back to Products</Link>} />
      </div>
    )
  }

  if (loading || !product) {
    return (
      <div className="p-4 sm:p-6">
        <DetailSkeleton />
      </div>
    )
  }

  const p = product
  const images: any[] = p.product_images || []
  const variants: any[] = p.product_variants || []
  const primaryImg = images.find((i: any) => i.is_primary) || images[0]
  const displayImg = images[selectedImage] || primaryImg

  const inventoryQty = p.has_variants ? Number(p.variant_inventory_total || 0) : Number(p.inventory_quantity || 0)
  const listedQty = Number(p.variant_stock_total || 0)

  const stockColor =
    inventoryQty === 0
      ? 'text-red-600 dark:text-red-400'
      : p.stock_status === 'Low Stock'
        ? 'text-orange-600 dark:text-orange-400'
        : 'text-green-600 dark:text-green-400'

  function shelfFor(variantId: string | null, subVariantId: string | null) {
    return shelfStock.filter(
      r =>
        (variantId ? r.variant_id === variantId : r.variant_id === null) &&
        (subVariantId ? r.sub_variant_id === subVariantId : r.sub_variant_id === null)
    )
  }

  const hasVariantShelf = shelfStock.some(r => r.variant_id !== null)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <DetailHeader
        back={{ href: ap('/admin/products'), label: 'Products' }}
        title={p.name}
        status={
          <>
            <span className={badgeCls(p.is_active ? 'green' : 'muted')}>{p.is_active ? 'Active' : 'Inactive'}</span>
            {p.is_featured && (
              <span className={`${badgeCls('amber')} inline-flex items-center gap-1`}>
                <Star className="w-3 h-3 fill-current" /> Featured
              </span>
            )}
            <ProductWarningBadges fragile={p.fragile} hazardous={p.hazardous} flammable={p.flammable} />
          </>
        }
        subtitle={
          p.sku ? (
            <span className="font-mono text-xs inline-flex items-center gap-1">
              {p.sku}
              <CopySku sku={p.sku} />
            </span>
          ) : undefined
        }
        actions={
          <>
            {canEnrich && (
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                className="control-md border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary"
              >
                <Sparkles className="w-4 h-4 text-accent-500" />
                AI
              </button>
            )}
            <Link
              href={ap(`/admin/products/${p.id}/analytics`)}
              className="control-md border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary"
            >
              Analytics
            </Link>
            {heldDraft ? (
              <ViewDraftLink held={heldDraft} />
            ) : (
              <RequireWrite scope="products:write">
                <button
                  type="button"
                  onClick={() => setShowDraftModal(true)}
                  className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
                >
                  Edit
                </button>
              </RequireWrite>
            )}
          </>
        }
      />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          {displayImg ? (
            <div className="aspect-square rounded-xl overflow-hidden border border-border-default bg-surface-secondary">
              <img
                src={displayImg.image_url || displayImg.thumbnail_url}
                alt={p.name}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="aspect-square rounded-xl border border-border-default bg-surface-secondary flex items-center justify-center">
              <svg className="w-16 h-16 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
          {images.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img: any, idx: number) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(idx)}
                  className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${idx === selectedImage ? 'border-accent-500' : 'border-border-default hover:border-border-secondary'}`}
                >
                  <img src={img.thumbnail_url || img.image_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-foreground">Pricing</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'MRP', val: p.mrp },
                {
                  label: p.has_variants ? 'From' : 'Selling Price',
                  val: p.has_variants ? p.variant_min_price : p.base_price,
                },
                { label: 'Ex-GST', val: p.has_variants ? null : p.price_ex_gst },
              ].map(
                ({ label, val }) =>
                  val != null && (
                    <div key={label}>
                      <p className="text-xs text-foreground-secondary mb-0.5">{label}</p>
                      <p className="text-base font-semibold text-foreground">{formatINR(Number(val))}</p>
                    </div>
                  )
              )}
              {(() => {
                // Prefer the explicit product discount_pct; otherwise derive it from MRP vs selling price.
                const selling = Number(p.has_variants ? p.variant_min_price : p.base_price) || 0
                const mrp = Number(p.mrp) || 0
                const pct =
                  p.discount_pct != null && Number(p.discount_pct) > 0
                    ? Number(p.discount_pct)
                    : mrp > 0 && mrp > selling
                      ? Math.round(((mrp - selling) / mrp) * 100)
                      : 0
                if (pct <= 0) return null
                return (
                  <div>
                    <p className="text-xs text-foreground-secondary mb-0.5">Discount</p>
                    <p className="text-base font-semibold text-green-600 dark:text-green-400">{pct}% off</p>
                  </div>
                )
              })()}
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
                <span className={`font-semibold ${stockColor}`}>
                  {inventoryQty}
                  {p.has_variants ? ' (variants)' : ''}
                </span>
              </div>
              {p.has_variants && (
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
                  <span className="text-foreground font-mono text-xs">
                    {p.length_cm} × {p.breadth_cm} × {p.height_cm} cm
                  </span>
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
              {p.is_subscription && <Field label="Subscription" value="Yes" />}
            </CollapsibleCard>

            {p.is_subscription && (
              <CollapsibleCard title="Subscription">
                <SubscriptionDetails p={p} variants={variants} />
              </CollapsibleCard>
            )}

            {/* — Description — */}
            {p.description && (
              <CollapsibleCard title="Description">
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{p.description}</p>
              </CollapsibleCard>
            )}

            {/* — Selling Units — */}
            <CollapsibleCard title="Selling Units">
              <UnitsManager productId={p.id} basePrice={p.base_price} readOnly />
            </CollapsibleCard>

            {/* — Physical & Compliance — */}
            <CollapsibleCard title="Physical & Compliance">
              {!p.material &&
              !p.finish &&
              !p.size &&
              !p.color &&
              !p.shelf_life_days &&
              !(Array.isArray(p.certifications) && p.certifications.length) &&
              !p.compliance_standard &&
              !p.safety_rating &&
              !p.warranty_months &&
              !p.fragile &&
              !p.hazardous &&
              !p.flammable &&
              !p.perishable &&
              !p.serialized ? (
                <p className="text-xs text-foreground-muted italic">No physical or compliance data configured.</p>
              ) : (
                <>
                  <Field label="Material" value={p.material} />
                  <Field label="Finish" value={p.finish} />
                  <Field label="Size" value={p.size} />
                  <Field label="Color" value={p.color} />
                  <Field label="Color Hex" value={p.color_hex} mono />
                  <Field label="Shelf Life (days)" value={p.shelf_life_days} />
                  <Field
                    label="Certifications"
                    value={
                      Array.isArray(p.certifications) && p.certifications.length ? p.certifications.join(', ') : null
                    }
                  />
                  <Field label="Compliance Standard" value={p.compliance_standard} />
                  <Field label="Safety Rating" value={p.safety_rating} />
                  <Field
                    label="Warranty"
                    value={
                      p.warranty_months
                        ? `${p.warranty_months} months${p.warranty_type ? ` (${p.warranty_type})` : ''}`
                        : null
                    }
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    {p.fragile && (
                      <span className={badgeCls('amber')}>
                        Fragile
                      </span>
                    )}
                    {p.hazardous && (
                      <span className={badgeCls('red')}>
                        Hazardous
                      </span>
                    )}
                    {p.flammable && (
                      <span className={badgeCls('amber')}>
                        Flammable
                      </span>
                    )}
                    {p.perishable && (
                      <span className={badgeCls('green')}>
                        Perishable
                      </span>
                    )}
                    {p.serialized && (
                      <span className={badgeCls('blue')}>
                        Serialized
                      </span>
                    )}
                  </div>
                </>
              )}
            </CollapsibleCard>

            {/* — Lifecycle & Merchandising — */}
            <CollapsibleCard title="Lifecycle & Merchandising">
              <Field
                label="Launch Date"
                value={p.launch_date ? new Date(p.launch_date).toLocaleDateString('en-IN') : null}
              />
              <Field
                label="Discontinue Date"
                value={p.discontinue_date ? new Date(p.discontinue_date).toLocaleDateString('en-IN') : null}
              />
              <Field label="Sort Order" value={p.sort_order} />
              <Field label="Views" value={p.views_count} />
              <Field label="Sales" value={p.sales_count} />
              {p.is_bundle && <Field label="Bundle" value="Yes" />}
              {p.is_digital && (
                <>
                  <Field label="Digital Product" value="Yes" />
                  <Field label="Download URL" value={p.download_url} mono />
                  <Field label="License Type" value={p.license_type} />
                  <Field label="File Format" value={p.file_format} />
                  <Field
                    label="Platform Compat."
                    value={
                      Array.isArray(p.platform_compatibility) && p.platform_compatibility.length
                        ? p.platform_compatibility.join(', ')
                        : null
                    }
                  />
                </>
              )}
            </CollapsibleCard>

            {/* — SEO & Audience — */}
            <CollapsibleCard title="SEO & Audience">
              <Field label="Meta Title" value={p.meta_title} />
              <Field label="Meta Description" value={p.meta_description} />
              <Field label="Searchable" value={p.is_searchable ? 'Yes' : 'No'} />
              <Field label="Target Gender" value={p.target_gender} />
              <Field
                label="Target Audience"
                value={
                  Array.isArray(p.target_audience) && p.target_audience.length ? p.target_audience.join(', ') : null
                }
              />
              <Field
                label="Age Range"
                value={p.age_min != null || p.age_max != null ? `${p.age_min ?? '—'} – ${p.age_max ?? '—'}` : null}
              />
            </CollapsibleCard>
          </div>

          {/* — Supplier Details — */}
          {hasInventory && <SupplierDetailsCard productId={id} />}

          {/* — Specifications — */}
          {p.specifications && Object.keys(p.specifications).length > 0 && (
            <CollapsibleCard title="Specifications">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                {Object.entries(p.specifications).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm border-b border-border-default/40 pb-1">
                    <span className="text-foreground-secondary">{k}</span>
                    <span className="min-w-0 break-words text-foreground font-mono text-xs">{String(v)}</span>
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

          {(p.ai_description ||
            p.ai_product_type ||
            p.ai_use_cases?.length ||
            p.ai_keywords?.length ||
            p.ai_features?.length ||
            p.ai_search_tags?.length ||
            p.ai_who_uses_it ||
            p.ai_application) && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">
                AI Intelligence
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {p.ai_product_type && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-0.5">Type</p>
                    <span className="text-xs font-medium text-accent-500">
                      {p.ai_product_type}
                    </span>
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
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">
                      Use Cases ({p.ai_use_cases.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_use_cases.map((t: string) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 bg-accent-500/5 text-accent-500 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {p.ai_keywords?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">
                      Keywords ({p.ai_keywords.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_keywords.map((t: string) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 bg-surface-secondary text-foreground-secondary rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {p.ai_features?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">
                      Features ({p.ai_features.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_features.map((t: string) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 bg-surface-secondary text-foreground-secondary rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {p.ai_search_tags?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-foreground-muted uppercase tracking-wide mb-1">
                      Search Tags ({p.ai_search_tags.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.ai_search_tags.map((t: string) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 bg-surface-secondary text-foreground-secondary rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {shelfStock.length > 0 && (
            <CollapsibleCard title="Shelf Locations">
              <ShelfBadges rows={shelfStock} />
            </CollapsibleCard>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
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
                  <th className="px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-foreground">
                    Image
                  </th>
                  <th className="px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-foreground">
                    Variant
                  </th>
                  <th className="px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-foreground hidden sm:table-cell">
                    SKU
                  </th>
                  <th className="px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-foreground hidden lg:table-cell">
                    Amazon ASIN
                  </th>
                  <th className="px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-foreground hidden xl:table-cell">
                    ISBN
                  </th>
                  <th className="px-4 py-2.5 text-right text-sm font-semibold uppercase tracking-wide text-foreground">
                    Price (incl. GST)
                  </th>
                  <th className="px-4 py-2.5 text-right text-sm font-semibold uppercase tracking-wide text-foreground hidden md:table-cell">
                    Ex-GST
                  </th>
                  <th className="px-4 py-2.5 text-right text-sm font-semibold uppercase tracking-wide text-foreground hidden md:table-cell">
                    MRP
                  </th>
                  <th className="px-4 py-2.5 text-right text-sm font-semibold uppercase tracking-wide text-foreground">
                    Inventory
                  </th>
                  <th className="px-4 py-2.5 text-right text-sm font-semibold uppercase tracking-wide text-foreground hidden lg:table-cell">
                    Stock Status
                  </th>
                  {hasVariantShelf && (
                    <th className="px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-foreground hidden xl:table-cell">
                      Shelf
                    </th>
                  )}
                  <th className="px-4 py-2.5 text-center text-sm font-semibold uppercase tracking-wide text-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {variants.map((v: any) => {
                  const subVariants: any[] = variantSubsShown(v)
                  const hasSubs = subVariants.length > 0
                  const vInventory = hasSubs
                    ? Number(v.sub_variant_inventory_total || 0)
                    : Number(v.inventory_quantity || 0)
                  const vListed = hasSubs ? v.stock_status || '—' : v.stock_status || '—'
                  const vStockColor =
                    vInventory === 0
                      ? 'text-red-600 dark:text-red-400'
                      : v.stock_status === 'Low Stock'
                        ? 'text-orange-600 dark:text-orange-400'
                        : 'text-foreground'
                  const vMinPrice = hasSubs ? Number(v.sub_variant_min_price || 0) : Number(v.price || 0)
                  const vShelf = hasSubs ? [] : shelfFor(v.id, null)
                  const vImgs: any[] = Array.isArray(v.variant_images) ? v.variant_images : []
                  const vImg = vImgs.find((i: any) => i.is_primary) || vImgs[0] || null
                  return (
                    <React.Fragment key={v.id}>
                      <tr className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-4 py-3">
                          {vImg ? (
                            <img
                              src={vImg.thumbnail_url || vImg.image_url}
                              alt={v.variant_name || ''}
                              className="w-12 h-12 rounded object-cover border border-border-default"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded border border-dashed border-border-secondary flex items-center justify-center text-foreground-muted">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {hasSubs ? (
                            <HoverCard
                              trigger={
                                <span className="cursor-help">
                                  {v.variant_name}
                                  <span className="ml-2 text-xs font-normal text-foreground-muted underline decoration-dotted">
                                    ({subVariants.length} sub-variants)
                                  </span>
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
                                            <span className="font-medium text-foreground truncate">
                                              {sv.sub_variant_name}
                                            </span>
                                            {sv.sku && (
                                              <span className="inline-flex items-center gap-1 font-mono text-foreground-muted text-[10px]">
                                                {sv.sku}
                                                <CopySku sku={sv.sku} />
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-3 text-right shrink-0">
                                            <span className="text-foreground-secondary">
                                              {sv.price ? formatINR(Number(sv.price)) : '—'}
                                            </span>
                                            <span
                                              className={`font-medium ${Number(sv.inventory_quantity || 0) === 0 ? 'text-red-600' : Number(sv.inventory_quantity || 0) <= 3 ? 'text-orange-600' : 'text-foreground'}`}
                                            >
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
                                              <span
                                                key={l.location_display_code}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-default bg-surface-secondary text-[10px]"
                                              >
                                                <span className="font-mono font-medium text-foreground">
                                                  {l.location_display_code}
                                                </span>
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
                        <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell">
                          <span className="inline-flex items-center gap-1">
                            {v.sku || '—'}
                            {v.sku && <CopySku sku={v.sku} />}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground-muted hidden lg:table-cell">
                          {v.asin ? (
                            <span title={v.asin_match ? `matched via ${v.asin_match}` : undefined}>{v.asin}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground-muted hidden xl:table-cell">
                          {v.isbn || '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {!hasSubs && vMinPrice > 0 ? formatINR(vMinPrice) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary hidden md:table-cell">
                          {!hasSubs && v.price_ex_gst ? formatINR(Number(v.price_ex_gst)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary hidden md:table-cell">
                          {!hasSubs && v.mrp ? formatINR(Number(v.mrp)) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${vStockColor}`}>{vInventory}</td>
                        <td className="px-4 py-3 text-right text-foreground-muted hidden lg:table-cell">{vListed}</td>
                        {hasVariantShelf && (
                          <td className="px-4 py-3 hidden xl:table-cell">
                            {hasSubs ? (
                              <span className="text-xs text-foreground-muted italic">see sub-variants</span>
                            ) : (
                              <ShelfBadges rows={vShelf} />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-center">
                          <StatusToggle
                            active={statusOverrides[v.id] ?? v.is_active}
                            blockedBy={!p.is_active ? 'product' : null}
                            canWrite={canWriteProducts}
                            busy={statusBusy === v.id}
                            onToggle={() =>
                              toggleStatus(
                                v.id,
                                `/api/admin/products/${id}/variants/${v.id}`,
                                !(statusOverrides[v.id] ?? v.is_active)
                              )
                            }
                          />
                        </td>
                      </tr>
                      {hasSubs &&
                        subVariants.map((sv: any) => {
                          const svInventory = Number(sv.inventory_quantity || 0)
                          const svListed = sv.stock_status || '—'
                          const svStockColor =
                            svInventory === 0
                              ? 'text-red-600 dark:text-red-400'
                              : svInventory <= 3
                                ? 'text-orange-600 dark:text-orange-400'
                                : 'text-foreground'
                          const svShelf = shelfFor(v.id, sv.id)
                          return (
                            <tr
                              key={sv.id}
                              className="bg-surface-secondary/30 hover:bg-surface-secondary/50 transition-colors"
                            >
                              <td className="px-4 py-2" />
                              <td className="px-4 py-2 pl-10 text-sm text-foreground-secondary">
                                ↳ {sv.sub_variant_name}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-foreground-muted hidden sm:table-cell">
                                <span className="inline-flex items-center gap-1">
                                  {sv.sku || '—'}
                                  {sv.sku && <CopySku sku={sv.sku} />}
                                </span>
                              </td>
                              <td className="px-4 py-2 hidden lg:table-cell" />
                              <td className="px-4 py-2 hidden xl:table-cell" />
                              <td className="px-4 py-2 text-right text-sm text-foreground">
                                {sv.price ? formatINR(Number(sv.price)) : '—'}
                              </td>
                              <td className="px-4 py-2 text-right text-sm text-foreground-secondary hidden md:table-cell">
                                {sv.price_ex_gst ? formatINR(Number(sv.price_ex_gst)) : '—'}
                              </td>
                              <td className="px-4 py-2 text-right text-sm text-foreground-secondary hidden md:table-cell">
                                {sv.mrp ? formatINR(Number(sv.mrp)) : '—'}
                              </td>
                              <td className={`px-4 py-2 text-right text-sm font-medium ${svStockColor}`}>
                                {svInventory}
                              </td>
                              <td className="px-4 py-2 text-right text-sm text-foreground-muted hidden lg:table-cell">
                                {svListed}
                              </td>
                              {hasVariantShelf && (
                                <td className="px-4 py-2 hidden xl:table-cell">
                                  <ShelfBadges rows={svShelf} />
                                </td>
                              )}
                              <td className="px-4 py-2 text-center">
                                <StatusToggle
                                  active={statusOverrides[sv.id] ?? sv.is_active}
                                  blockedBy={
                                    !p.is_active
                                      ? 'product'
                                      : !(statusOverrides[v.id] ?? v.is_active)
                                        ? 'variant'
                                        : null
                                  }
                                  canWrite={canWriteProducts}
                                  busy={statusBusy === sv.id}
                                  onToggle={() =>
                                    toggleStatus(
                                      sv.id,
                                      `/api/admin/products/${id}/variants/${v.id}/sub-variants/${sv.id}`,
                                      !(statusOverrides[sv.id] ?? sv.is_active)
                                    )
                                  }
                                />
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
          onApproved={() => {
            setAiOpen(false)
            loadProduct()
          }}
        />
      )}

      {hasInventory && <ProductStockMovements productId={id} />}
    </div>
  )
}
