'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import CustomSelect from '@/components/visitor/CustomSelect'
import QuantityInput from '@/components/shared/QuantityInput'
import CopySku from '@/components/ui/CopySku'
import { applyDiscount } from '@/lib/pricing'
import { bp } from '@/lib/business-path'

interface SubVariantOption {
  id: string
  sub_variant_name: string
  sku?: string | null
  price?: number | null
  mrp?: number | null
  stock_status?: string
  is_active?: boolean
}

interface VariantOption {
  id: string
  variant_name: string
  sku?: string | null
  price?: number | null
  mrp?: number | null
  stock_status?: string
  unit?: string | null
  sub_variants?: SubVariantOption[]
}

interface QuoteItem {
  productId?: string
  variantId?: string
  subVariantId?: string
  description: string
  quantity: number
  unit?: string
  unitMin?: number
  unitMax?: number
  unitStep?: number
  unitFactor?: number
  unitDimension?: string
  currentPrice?: number | null
  imageUrl?: string | null
  brandName?: string | null
  categoryName?: string | null
  sku?: string | null
  stockStatus?: 'in' | 'out' | null
  variants?: VariantOption[]
  businessDiscountPct?: number
}

interface ProductUnit {
  id: string
  variant_id: string | null
  sub_variant_id: string | null
  unit: string
  factor: number
  is_base: boolean
  display_label: string | null
  dimension: string
  min_qty?: number | null
  max_qty?: number | null
  qty_step?: number | null
}

interface Props {
  items: QuoteItem[]
  className?: string
  label?: string
  unitMeta?: { key: string; label: string | null; min: number; max: number | null; step: number; factor: number; dimension: string }
  productUnits?: ProductUnit[]
  sellUnitId?: string | null
}


const MAX_DISCOUNT_PCT = 30

function PriceBreakdown({ currentPrice, requestedPrice, discountPct, unitLabel }: {
  currentPrice: number
  requestedPrice: string
  discountPct: string
  unitLabel?: string
}) {
  const target = requestedPrice ? parseFloat(requestedPrice) : null
  const pct = discountPct ? parseFloat(discountPct) : null
  const derived = target ?? (pct != null && pct > 0 && pct < 100 ? applyDiscount(currentPrice, pct) : null)
  const effectivePct = derived != null ? Math.round(((currentPrice - derived) / currentPrice) * 100) : null
  const saving = derived != null ? currentPrice - derived : null
  const minAllowed = applyDiscount(currentPrice, MAX_DISCOUNT_PCT)
  const overLimit = derived != null && derived < minAllowed

  return (
    <div className="rounded-xl border border-accent-200 dark:border-accent-800 bg-accent-50/50 dark:bg-accent-900/20 overflow-hidden">
      <div className="px-3 py-2.5 grid grid-cols-3 divide-x divide-accent-200 dark:divide-accent-800">
        <div className="pr-2 text-center">
          <p className="text-[9px] uppercase tracking-wide text-foreground-muted mb-0.5">Current</p>
          <p className="text-xs font-bold text-foreground">₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="px-2 text-center">
          <p className="text-[9px] uppercase tracking-wide text-foreground-muted mb-0.5">Your Target</p>
          <p className={`text-xs font-bold ${overLimit ? 'text-red-500' : derived != null ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}`}>
            {derived != null ? `₹${derived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
          </p>
        </div>
        <div className="pl-2 text-center">
          <p className="text-[9px] uppercase tracking-wide text-foreground-muted mb-0.5">Discount</p>
          <p className={`text-xs font-bold ${overLimit ? 'text-red-500' : effectivePct != null && effectivePct > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
            {effectivePct != null && effectivePct > 0 ? `${effectivePct}% off` : '—'}
          </p>
        </div>
      </div>
      {overLimit && (
        <div className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 text-center">
          <p className="text-[10px] font-medium text-red-600 dark:text-red-400">
            Maximum discount is {MAX_DISCOUNT_PCT}% — minimum target price is ₹{minAllowed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        </div>
      )}
      {!overLimit && saving != null && saving > 0 && (
        <div className="px-3 py-1.5 bg-green-50 dark:bg-green-900/20 border-t border-green-100 dark:border-green-900/40 text-center">
          <p className="text-[10px] font-medium text-green-700 dark:text-green-400">
            Potential saving of ₹{saving.toLocaleString('en-IN', { minimumFractionDigits: 2 })} per {unitLabel || 'unit'} if approved
          </p>
        </div>
      )}
      {derived != null && derived >= currentPrice && (
        <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900/40 text-center">
          <p className="text-[10px] text-amber-700 dark:text-amber-400">Target price is at or above current price</p>
        </div>
      )}
    </div>
  )
}

type FieldState = {
  quantity: number
  quantityRaw: string
  unit: string
  unitMin: number
  unitMax: number | null
  unitStep: number
  unitFactor: number
  unitDimension: string
  requested_price: string
  discount_pct: string
  notes: string
  selectedVariantId: string
  selectedSubVariantId: string
}

function resolveItemState(item: QuoteItem, f: FieldState) {
  const unitFactor = f.unitFactor > 1 ? f.unitFactor : 1
  if (!item.variants?.length) {
    const basePrice = item.currentPrice ?? null
    return {
      currentPrice: basePrice != null ? basePrice * unitFactor : null,
      sku: item.sku ?? null,
      stockStatus: item.stockStatus ?? null,
      description: item.description,
      variantId: item.variantId,
      subVariantId: item.subVariantId,
    }
  }
  const variant = item.variants.find(v => v.id === f.selectedVariantId) ?? null
  const subVariant = variant?.sub_variants?.find(sv => sv.id === f.selectedSubVariantId) ?? null
  const rawPrice = subVariant?.price ?? variant?.price ?? null
  const discPct = item.businessDiscountPct ?? 0
  const basePrice = rawPrice != null
    ? (discPct > 0 ? applyDiscount(Number(rawPrice), discPct) : Number(rawPrice))
    : item.currentPrice ?? null
  const currentPrice = basePrice != null ? basePrice * unitFactor : null
  const sku = subVariant?.sku || variant?.sku || item.sku || null
  const itemStockStatus = subVariant?.stock_status ?? variant?.stock_status ?? null
  const stockStatus: 'in' | 'out' | null = itemStockStatus != null ? (itemStockStatus !== 'Out of Stock' ? 'in' : 'out') : item.stockStatus ?? null
  const descParts = [item.description.split(' — ')[0], variant?.variant_name, subVariant?.sub_variant_name].filter(Boolean)
  return {
    currentPrice,
    sku,
    stockStatus,
    description: descParts.join(' — '),
    variantId: variant?.id ?? item.variantId,
    subVariantId: subVariant?.id ?? item.subVariantId,
  }
}

function itemHasInput(f: FieldState) {
  return !!(f.requested_price || f.discount_pct || f.notes)
}

export default function RequestQuoteButton({ items, className, label = 'Request Quote', unitMeta, productUnits = [], sellUnitId }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  const [fields, setFields] = useState<FieldState[]>(() =>
    items.map(item => ({
      quantity: item.quantity || 1,
      quantityRaw: String(item.quantity || 1),
      unit: item.unit || 'Nos',
      unitMin: item.unitMin ?? 1,
      unitMax: item.unitMax ?? null,
      unitStep: item.unitStep ?? 1,
      unitFactor: item.unitFactor ?? 1,
      unitDimension: item.unitDimension ?? 'count',
      requested_price: '',
      discount_pct: '',
      notes: '',
      selectedVariantId: item.variantId || '',
      selectedSubVariantId: item.subVariantId || '',
    }))
  )
  const [overallNotes, setOverallNotes] = useState('')

  useEffect(() => {
    if (!open || !unitMeta) return
    setFields(prev => prev.map((f, idx) => {
      if (idx !== activeIdx) return f
      const newMin = unitMeta.min
      return {
        ...f,
        unit: unitMeta.key,
        unitMin: newMin,
        unitMax: unitMeta.max,
        unitStep: unitMeta.step,
        unitFactor: unitMeta.factor,
        unitDimension: unitMeta.dimension,
        quantity: newMin,
        quantityRaw: String(newMin),
      }
    }))
  }, [unitMeta, open, activeIdx])

  if (!user?.isBusiness || user.approvalStatus !== 'approved') return null

  const multiItem = items.length > 1

  function updateField(i: number, key: keyof FieldState, value: string | number) {
    setFields(prev => prev.map((f, idx) => {
      if (idx !== i) return f
      if (key === 'discount_pct' && value !== '') {
        const capped = Math.min(parseFloat(String(value)), MAX_DISCOUNT_PCT)
        return { ...f, discount_pct: String(capped), requested_price: '' }
      }
      if (key === 'requested_price' && value !== '') return { ...f, requested_price: String(value), discount_pct: '' }
      return { ...f, [key]: value }
    }))
  }

  function updateVariantSelection(i: number, variantId: string, subVariantId: string) {
    const resolvedUnit = (() => {
      if (!productUnits.length) return null
      // Determine sell_unit_id: check the variant in items (passed via sellUnitId at product level)
      // For sub-variant products, the variant's sell_unit_id drives the default sell unit.
      // We look up the unit by sell_unit_id first, then fall back to is_base.
      const effectiveSellUnitId = sellUnitId ?? null
      if (effectiveSellUnitId) {
        const u = productUnits.find(u => u.id === effectiveSellUnitId)
        if (u) return u
      }
      if (subVariantId) {
        const u = productUnits.find(u => u.sub_variant_id === subVariantId && u.is_base)
          ?? productUnits.find(u => u.sub_variant_id === subVariantId)
        if (u) return u
      }
      if (variantId) {
        const u = productUnits.find(u => u.variant_id === variantId && u.sub_variant_id === null && u.is_base)
          ?? productUnits.find(u => u.variant_id === variantId && u.sub_variant_id === null)
        if (u) return u
      }
      return productUnits.find(u => u.variant_id === null && u.sub_variant_id === null && u.is_base)
        ?? null
    })()
    setFields(prev => prev.map((f, idx) => {
      if (idx !== i) return f
      return {
        ...f,
        selectedVariantId: variantId,
        selectedSubVariantId: subVariantId,
        ...(resolvedUnit ? {
          unit: resolvedUnit.unit,
          unitFactor: Number(resolvedUnit.factor),
          unitDimension: resolvedUnit.dimension,
          unitMin: resolvedUnit.min_qty != null ? Number(resolvedUnit.min_qty) : 1,
          unitMax: resolvedUnit.max_qty != null ? Number(resolvedUnit.max_qty) : null,
          unitStep: resolvedUnit.qty_step != null ? Number(resolvedUnit.qty_step) : (resolvedUnit.dimension === 'count' ? 1 : 0.001),
          quantity: resolvedUnit.min_qty != null ? Number(resolvedUnit.min_qty) : 1,
          quantityRaw: String(resolvedUnit.min_qty != null ? Number(resolvedUnit.min_qty) : 1),
        } : {}),
      }
    }))
  }

  function handleOpen() {
    setFields(items.map(item => ({
      quantity: item.quantity || 1,
      quantityRaw: String(item.quantity || 1),
      unit: item.unit || 'Nos',
      unitDimension: item.unitDimension ?? 'count',
      unitMin: item.unitMin ?? 1,
      unitMax: item.unitMax ?? null,
      unitStep: item.unitStep ?? 1,
      unitFactor: item.unitFactor ?? 1,
      requested_price: '',
      discount_pct: '',
      notes: '',
      selectedVariantId: item.variantId || '',
      selectedSubVariantId: item.subVariantId || '',
    })))
    setOverallNotes('')
    setActiveIdx(0)
    setOpen(true)
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      const payload = {
        notes: overallNotes.trim() || null,
        items: items.map((item, i) => {
          const f = fields[i]
          const resolved = resolveItemState(item, f)
          let requested_price: number | null = null
          if (f.requested_price) {
            requested_price = parseFloat(f.requested_price)
          } else if (f.discount_pct && resolved.currentPrice) {
            requested_price = applyDiscount(resolved.currentPrice, parseFloat(f.discount_pct))
          }
          // enforce 30% cap — silently clamp; PriceBreakdown already warns the user
          if (requested_price != null && resolved.currentPrice != null && resolved.currentPrice > 0) {
            const minAllowed = applyDiscount(resolved.currentPrice, MAX_DISCOUNT_PCT)
            if (requested_price < minAllowed) requested_price = minAllowed
          }
          return {
            productId: item.productId,
            variantId: resolved.variantId,
            subVariantId: resolved.subVariantId,
            description: resolved.description,
            quantity: Number(f.quantity) || 1,
            unit: f.unit,
            requested_price,
            notes: f.notes.trim() || null,
          }
        }),
      }
      const res = await fetch('/api/business/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to submit quote request', 'error')
        return
      }
      setOpen(false)
      showToast(`Quote request ${data.rfq?.rfq_number} submitted! Our team will get back to you.`, 'success')
      router.push(bp('/business/quotes'))
    } catch {
      showToast('Failed to submit quote request', 'error')
    } finally {
      setLoading(false)
    }
  }

  const activeItem = items[activeIdx]
  const activeField = fields[activeIdx]
  const activeResolved = resolveItemState(activeItem, activeField)

  const hasOverLimit = fields.some((f, i) => {
    const resolved = resolveItemState(items[i], f)
    if (!resolved.currentPrice || !f.requested_price) return false
    const target = parseFloat(f.requested_price)
    if (isNaN(target)) return false
    return target < applyDiscount(resolved.currentPrice, MAX_DISCOUNT_PCT)
  })

  const activeVariant = activeItem.variants?.find(v => v.id === activeField.selectedVariantId) ?? null
  const activeSubVariants = activeVariant?.sub_variants?.filter(sv => sv.is_active !== false) ?? []
  const hasVariantSelector = (activeItem.variants?.length ?? 0) > 0

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={className || 'w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg border-2 border-accent-500 text-accent-600 dark:text-accent-400 font-semibold text-sm hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors'}
      >
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
        {label}
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => !loading && setOpen(false)} />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
            <div className="bg-surface-elevated border border-border-default rounded-2xl shadow-2xl w-full max-w-4xl pointer-events-auto flex flex-col max-h-[94dvh]">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Request a Quote</h2>
                  {multiItem && (
                    <p className="text-xs text-foreground-muted mt-0.5">{items.length} items · click each to set target price</p>
                  )}
                </div>
                <button
                  onClick={() => !loading && setOpen(false)}
                  className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body — stacks on mobile, side-by-side on sm+ */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0">

                {/* LEFT — product info / item list */}
                <div className={`flex flex-col border-b sm:border-b-0 sm:border-r border-border-default sm:shrink-0 ${multiItem ? 'sm:w-64 max-h-40 sm:max-h-none' : 'sm:w-72 max-h-44 sm:max-h-none'}`}>

                  {multiItem ? (
                    /* Cart: scrollable item list */
                    <div className="flex-1 overflow-y-auto py-2">
                      {items.map((item, i) => {
                        const f = fields[i]
                        const resolved = resolveItemState(item, f)
                        const hasInput = itemHasInput(f)
                        const isActive = i === activeIdx
                        return (
                          <button
                            key={i}
                            onClick={() => setActiveIdx(i)}
                            className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors border-l-2 ${
                              isActive
                                ? 'bg-accent-50 dark:bg-accent-900/20 border-l-accent-500'
                                : 'hover:bg-surface-secondary border-l-transparent'
                            }`}
                          >
                            <div className="w-10 h-10 rounded-lg border border-border-default bg-surface flex-shrink-0 overflow-hidden">
                              {item.imageUrl ? (
                                <img src={item.imageUrl} alt={item.description} className="w-full h-full object-contain p-0.5" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium leading-snug line-clamp-2 ${isActive ? 'text-accent-600 dark:text-accent-400' : 'text-foreground'}`}>
                                {item.description.split(' — ')[0]}
                              </p>
                              {resolved.description.includes(' — ') && (
                                <p className="text-[10px] text-foreground-muted truncate mt-0.5">
                                  {resolved.description.split(' — ').slice(1).join(' — ')}
                                </p>
                              )}
                              <div className="flex items-center gap-1.5 mt-1">
                                {resolved.stockStatus != null && (
                                  <span className={`flex items-center gap-0.5 text-[9px] font-medium ${resolved.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                    <span className={`w-1 h-1 rounded-full ${resolved.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                                    {resolved.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
                                  </span>
                                )}
                                {hasInput && (
                                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent-500 flex-shrink-0" title="Target price set" />
                                )}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    /* Single product: full product info panel */
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {/* Product image */}
                      <div className="h-28 sm:aspect-square sm:h-auto w-full rounded-xl border border-border-default bg-surface overflow-hidden">
                        {activeItem.imageUrl ? (
                          <img src={activeItem.imageUrl} alt={activeItem.description} className="w-full h-full object-contain p-3" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-16 h-16 text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                          </div>
                        )}
                      </div>

                      {/* Product meta */}
                      <div>
                        <p className="text-sm font-semibold text-foreground leading-snug">
                          {activeItem.description.split(' — ')[0]}
                        </p>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                          {activeItem.brandName && (
                            <span className="text-xs text-foreground-muted">{activeItem.brandName}</span>
                          )}
                          {activeItem.categoryName && (
                            <span className="text-xs text-foreground-muted">{activeItem.categoryName}</span>
                          )}
                        </div>
                        {activeResolved.sku && (
                          <p className="text-xs font-mono text-foreground-muted mt-1">SKU: {activeResolved.sku}{activeResolved.sku && <CopySku sku={activeResolved.sku} className="ml-1" />}</p>
                        )}
                        {activeResolved.stockStatus != null && (
                          <span className={`inline-flex items-center gap-1 mt-2 text-xs font-medium ${activeResolved.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${activeResolved.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                            {activeResolved.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
                          </span>
                        )}
                      </div>

                      {/* Variant selector */}
                      {hasVariantSelector && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-medium text-foreground-secondary mb-1">
                              Variant <span className="text-red-500">*</span>
                            </label>
                            <CustomSelect
                              value={activeField.selectedVariantId}
                              options={activeItem.variants!.map(v => ({ value: v.id, label: v.variant_name }))}
                              onChange={varId => updateVariantSelection(activeIdx, varId, '')}
                              placeholder="Select a variant"
                            />
                          </div>
                          {activeSubVariants.length > 0 && (
                            <div>
                              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                                Size / Option
                              </label>
                              <CustomSelect
                                value={activeField.selectedSubVariantId}
                                options={activeSubVariants.map(sv => ({ value: sv.id, label: sv.sub_variant_name }))}
                                onChange={svId => updateVariantSelection(activeIdx, activeField.selectedVariantId, svId)}
                                placeholder="Select an option"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Current price display */}
                      {activeResolved.currentPrice != null && activeResolved.currentPrice > 0 && (
                        <div className="pt-2 border-t border-border-default">
                          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-0.5">Current Price</p>
                          <p className="text-xl font-bold text-primary-600 dark:text-primary-400">
                            ₹{activeResolved.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                          {activeItem.businessDiscountPct && activeItem.businessDiscountPct > 0 && (
                            <p className="text-[10px] text-accent-600 dark:text-accent-400 mt-0.5">
                              ✦ Includes your {activeItem.businessDiscountPct}% business discount
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* RIGHT — form for active item */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

                    {/* For multi-item: show compact product info at top of form */}
                    {multiItem && (
                      <div className="flex items-start gap-3 p-3 bg-surface-secondary rounded-xl">
                        <div className="w-14 h-14 rounded-lg border border-border-default bg-surface flex-shrink-0 overflow-hidden">
                          {activeItem.imageUrl ? (
                            <img src={activeItem.imageUrl} alt={activeItem.description} className="w-full h-full object-contain p-1" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{activeResolved.description}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                            {activeItem.brandName && <span className="text-xs text-foreground-muted">{activeItem.brandName}</span>}
                            {activeResolved.sku && <span className="text-xs font-mono text-foreground-muted">SKU: {activeResolved.sku}<CopySku sku={activeResolved.sku} className="ml-1" /></span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {activeResolved.stockStatus != null && (
                              <span className={`flex items-center gap-1 text-[10px] font-medium ${activeResolved.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${activeResolved.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                                {activeResolved.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
                              </span>
                            )}
                            {activeResolved.currentPrice != null && activeResolved.currentPrice > 0 && (
                              <span className="text-xs font-bold text-primary-600 dark:text-primary-400">
                                ₹{activeResolved.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Quantity + Unit */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        Quantity <span className="text-red-500">*</span>
                      </label>
                      <QuantityInput
                        dimension={activeField.unitDimension}
                        quantity={activeField.quantity}
                        quantityRaw={activeField.quantityRaw}
                        unitLabel={activeField.unit || null}
                        unitKey={activeField.unit || 'Nos'}
                        effectiveStock={activeField.unitMax ?? 9999}
                        qtyStep={activeField.unitStep}
                        qtyMin={activeField.unitMin}
                        qtyMax={activeField.unitMax ?? undefined}
                        onChange={(qty, raw) => {
                          setFields(prev => prev.map((f, idx) =>
                            idx !== activeIdx ? f : { ...f, quantity: qty, quantityRaw: raw }
                          ))
                        }}
                      />
                      {activeField.unitFactor > 1 && (
                        <p className="mt-1 text-[11px] text-foreground-muted">
                          = {Math.round(Number(activeField.quantity) * activeField.unitFactor)} pcs
                        </p>
                      )}
                    </div>

                    {/* Target price */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-foreground-secondary">
                        Target Price <span className="text-foreground-muted font-normal">— optional, enter one</span>
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-foreground-muted mb-1">₹ per {activeField.unit || 'unit'}</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted text-sm">₹</span>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={activeField.requested_price}
                              onChange={e => updateField(activeIdx, 'requested_price', e.target.value)}
                              placeholder={activeResolved.currentPrice
                                ? `e.g. ${(activeResolved.currentPrice * 0.9).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                : 'e.g. 350.00'}
                              className="w-full pl-7 pr-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] text-foreground-muted mb-1">% discount</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              max={MAX_DISCOUNT_PCT}
                              step={0.1}
                              value={activeField.discount_pct}
                              onChange={e => updateField(activeIdx, 'discount_pct', e.target.value)}
                              placeholder="e.g. 10"
                              className="w-full pl-3 pr-8 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted text-sm">%</span>
                          </div>
                        </div>
                      </div>
                      {activeResolved.currentPrice != null && activeResolved.currentPrice > 0 && (
                        <PriceBreakdown
                          currentPrice={activeResolved.currentPrice}
                          requestedPrice={activeField.requested_price}
                          discountPct={activeField.discount_pct}
                          unitLabel={activeField.unit || undefined}
                        />
                      )}
                    </div>

                    {/* Item notes */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        Item Notes <span className="text-foreground-muted font-normal">— grade, brand, specs, etc.</span>
                      </label>
                      <input
                        type="text"
                        value={activeField.notes}
                        onChange={e => updateField(activeIdx, 'notes', e.target.value)}
                        placeholder="e.g. Grade 10.9, stainless, specific tolerance…"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                      />
                    </div>

                    {/* Multi-item navigation hint */}
                    {multiItem && (
                      <div className="flex items-center justify-between pt-1">
                        <button
                          onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
                          disabled={activeIdx === 0}
                          className="text-xs text-accent-600 dark:text-accent-400 disabled:opacity-30 hover:underline"
                        >
                          ← Previous item
                        </button>
                        <span className="text-xs text-foreground-muted">{activeIdx + 1} / {items.length}</span>
                        <button
                          onClick={() => setActiveIdx(i => Math.min(items.length - 1, i + 1))}
                          disabled={activeIdx === items.length - 1}
                          className="text-xs text-accent-600 dark:text-accent-400 disabled:opacity-30 hover:underline"
                        >
                          Next item →
                        </button>
                      </div>
                    )}

                    {/* Overall notes (always visible in right panel) */}
                    <div className="pt-2 border-t border-border-default">
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        Additional Notes <span className="text-foreground-muted font-normal">— delivery, urgency, project context</span>
                      </label>
                      <textarea
                        value={overallNotes}
                        onChange={e => setOverallNotes(e.target.value)}
                        rows={2}
                        placeholder="Any other requirements or context for this quote…"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                      />
                    </div>
                  </div>

                  {/* Footer inside right panel */}
                  <div className="px-5 py-4 border-t border-border-default shrink-0 space-y-2">
                    {hasOverLimit && (
                      <p className="text-xs text-red-500 dark:text-red-400 text-center">
                        Target price exceeds the 30% discount limit — please adjust before submitting.
                      </p>
                    )}
                    <div className="flex gap-3">
                    <button
                      onClick={handleSubmit}
                      disabled={loading || !fields.some(itemHasInput) || hasOverLimit}
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {loading ? 'Submitting…' : `Submit Quote${multiItem ? ` (${items.length} items)` : ''}`}
                    </button>
                    <button
                      onClick={() => setOpen(false)}
                      disabled={loading}
                      className="px-5 py-2.5 border border-border-default text-sm font-medium rounded-lg hover:bg-surface-secondary transition-colors disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
