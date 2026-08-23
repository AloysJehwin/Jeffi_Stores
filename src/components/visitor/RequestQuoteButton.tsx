'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import CopySku from '@/components/ui/CopySku'
import { applyDiscount } from '@/lib/pricing'

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
  currentPrice?: number | null
  imageUrl?: string | null
  brandName?: string | null
  categoryName?: string | null
  sku?: string | null
  stockStatus?: 'in' | 'out' | null
}

interface Props {
  items: QuoteItem[]
  className?: string
  label?: string
}

const MAX_DISCOUNT_PCT = 30

function PriceBreakdown({ currentPrice, requestedPrice, discountPct }: {
  currentPrice: number
  requestedPrice: string
  discountPct: string
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
            Potential saving of ₹{saving.toLocaleString('en-IN', { minimumFractionDigits: 2 })} per unit if approved
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
  unit: string
  unitMin: number
  unitMax: number | null
  unitStep: number
  unitFactor: number
  requested_price: string
  discount_pct: string
  notes: string
}

function itemHasInput(f: FieldState) {
  return !!(f.requested_price || f.discount_pct || f.notes)
}

export default function RequestQuoteButton({ items, className, label = 'Request Quote' }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  const [fields, setFields] = useState<FieldState[]>(() =>
    items.map(item => ({
      quantity: item.quantity || 1,
      unit: item.unit || 'Nos',
      unitMin: item.unitMin ?? 1,
      unitMax: item.unitMax ?? null,
      unitStep: item.unitStep ?? 1,
      unitFactor: item.unitFactor ?? 1,
      requested_price: '',
      discount_pct: '',
      notes: '',
    }))
  )
  const [overallNotes, setOverallNotes] = useState('')

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

  function handleOpen() {
    setFields(items.map(item => ({
      quantity: item.quantity || 1,
      unit: item.unit || 'Nos',
      unitMin: item.unitMin ?? 1,
      unitMax: item.unitMax ?? null,
      unitStep: item.unitStep ?? 1,
      unitFactor: item.unitFactor ?? 1,
      requested_price: '',
      discount_pct: '',
      notes: '',
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
          let requested_price: number | null = null
          if (f.requested_price) {
            requested_price = parseFloat(f.requested_price)
          } else if (f.discount_pct && item.currentPrice) {
            requested_price = applyDiscount(item.currentPrice, parseFloat(f.discount_pct))
          }
          if (requested_price != null && item.currentPrice != null && item.currentPrice > 0) {
            const minAllowed = applyDiscount(item.currentPrice, MAX_DISCOUNT_PCT)
            if (requested_price < minAllowed) requested_price = minAllowed
          }
          return {
            productId: item.productId,
            variantId: item.variantId,
            subVariantId: item.subVariantId,
            description: item.description,
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
      router.push('/account/quotes')
    } catch {
      showToast('Failed to submit quote request', 'error')
    } finally {
      setLoading(false)
    }
  }

  const activeItem = items[activeIdx]
  const activeField = fields[activeIdx]

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

              {/* Body */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0">

                {/* LEFT — product info / item list */}
                <div className={`flex flex-col border-b sm:border-b-0 sm:border-r border-border-default sm:shrink-0 ${multiItem ? 'sm:w-64 max-h-40 sm:max-h-none' : 'sm:w-72 max-h-44 sm:max-h-none'}`}>

                  {multiItem ? (
                    <div className="flex-1 overflow-y-auto py-2">
                      {items.map((item, i) => {
                        const f = fields[i]
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
                                {item.description}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                {item.stockStatus != null && (
                                  <span className={`flex items-center gap-0.5 text-[9px] font-medium ${item.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                    <span className={`w-1 h-1 rounded-full ${item.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                                    {item.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
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
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

                      <div>
                        <p className="text-sm font-semibold text-foreground leading-snug">{activeItem.description}</p>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                          {activeItem.brandName && (
                            <span className="text-xs text-foreground-muted">{activeItem.brandName}</span>
                          )}
                          {activeItem.categoryName && (
                            <span className="text-xs text-foreground-muted">{activeItem.categoryName}</span>
                          )}
                        </div>
                        {activeItem.sku && (
                          <p className="text-xs font-mono text-foreground-muted mt-1">SKU: {activeItem.sku}<CopySku sku={activeItem.sku} className="ml-1" /></p>
                        )}
                        {activeItem.stockStatus != null && (
                          <span className={`inline-flex items-center gap-1 mt-2 text-xs font-medium ${activeItem.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${activeItem.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                            {activeItem.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
                          </span>
                        )}
                      </div>

                      {activeItem.currentPrice != null && activeItem.currentPrice > 0 && (
                        <div className="pt-2 border-t border-border-default">
                          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-0.5">Current Price</p>
                          <p className="text-xl font-bold text-primary-600 dark:text-primary-400">
                            ₹{activeItem.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* RIGHT — form for active item */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

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
                          <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{activeItem.description}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                            {activeItem.brandName && <span className="text-xs text-foreground-muted">{activeItem.brandName}</span>}
                            {activeItem.sku && <span className="text-xs font-mono text-foreground-muted">SKU: {activeItem.sku}<CopySku sku={activeItem.sku} className="ml-1" /></span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {activeItem.stockStatus != null && (
                              <span className={`flex items-center gap-1 text-[10px] font-medium ${activeItem.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${activeItem.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                                {activeItem.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
                              </span>
                            )}
                            {activeItem.currentPrice != null && activeItem.currentPrice > 0 && (
                              <span className="text-xs font-bold text-primary-600 dark:text-primary-400">
                                ₹{activeItem.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={activeField.unitMin}
                          max={activeField.unitMax ?? undefined}
                          step={activeField.unitStep}
                          value={activeField.quantity}
                          onChange={e => updateField(activeIdx, 'quantity', e.target.value)}
                          className="flex-1 px-3 py-[10px] text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                        />
                        <span className="inline-flex items-center px-3 py-2 rounded-lg border border-border-default bg-surface-secondary text-sm font-medium text-foreground-secondary whitespace-nowrap">
                          {activeField.unit || 'Nos'}
                        </span>
                      </div>
                      {activeField.unitFactor > 1 && (
                        <p className="mt-1 text-[11px] text-foreground-muted">
                          = {Math.round(Number(activeField.quantity) * activeField.unitFactor)} pcs
                        </p>
                      )}
                      {(activeField.unitMin > 1 || activeField.unitMax != null || activeField.unitStep !== 1) && (
                        <p className="mt-0.5 text-[11px] text-foreground-muted">
                          Min {activeField.unitMin}{activeField.unitMax != null ? ` · Max ${activeField.unitMax}` : ''}{activeField.unitStep !== 1 ? ` · Step ${activeField.unitStep}` : ''}
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
                          <label className="block text-[11px] text-foreground-muted mb-1">₹ per unit</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted text-sm">₹</span>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={activeField.requested_price}
                              onChange={e => updateField(activeIdx, 'requested_price', e.target.value)}
                              placeholder="e.g. 350.00"
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
                      {activeItem.currentPrice != null && activeItem.currentPrice > 0 && (
                        <PriceBreakdown
                          currentPrice={activeItem.currentPrice}
                          requestedPrice={activeField.requested_price}
                          discountPct={activeField.discount_pct}
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

                  <div className="px-5 py-4 border-t border-border-default shrink-0 flex gap-3">
                    <button
                      onClick={handleSubmit}
                      disabled={loading || !fields.some(itemHasInput)}
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
        </>,
        document.body
      )}
    </>
  )
}
