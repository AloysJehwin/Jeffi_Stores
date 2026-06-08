'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import CustomSelect from '@/components/visitor/CustomSelect'

interface QuoteItem {
  productId?: string
  variantId?: string
  subVariantId?: string
  description: string
  quantity: number
  unit?: string
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

const UNITS = ['Nos', 'Pcs', 'Kg', 'g', 'L', 'mL', 'Box', 'Set', 'Pair', 'Roll', 'Sheet', 'Bag']
const UNIT_OPTIONS = UNITS.map(u => ({ value: u, label: u }))

function PriceBreakdown({ currentPrice, requestedPrice, discountPct }: {
  currentPrice: number
  requestedPrice: string
  discountPct: string
}) {
  const target = requestedPrice ? parseFloat(requestedPrice) : null
  const pct = discountPct ? parseFloat(discountPct) : null
  const derived = target ?? (pct != null && pct > 0 && pct < 100 ? currentPrice * (1 - pct / 100) : null)
  const effectivePct = derived != null ? Math.round(((currentPrice - derived) / currentPrice) * 100) : null
  const saving = derived != null ? currentPrice - derived : null

  return (
    <div className="mt-2 rounded-xl border border-accent-200 dark:border-accent-800 bg-accent-50/50 dark:bg-accent-900/20 overflow-hidden">
      <div className="px-4 py-3 grid grid-cols-3 divide-x divide-accent-200 dark:divide-accent-800">
        <div className="pr-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-0.5">Current</p>
          <p className="text-sm font-bold text-foreground">₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="px-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-0.5">Your Target</p>
          <p className={`text-sm font-bold ${derived != null ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}`}>
            {derived != null ? `₹${derived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
          </p>
        </div>
        <div className="pl-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-foreground-muted mb-0.5">Discount</p>
          <p className={`text-sm font-bold ${effectivePct != null && effectivePct > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
            {effectivePct != null && effectivePct > 0 ? `${effectivePct}% off` : '—'}
          </p>
        </div>
      </div>
      {saving != null && saving > 0 && (
        <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-t border-green-100 dark:border-green-900/40 text-center">
          <p className="text-xs font-medium text-green-700 dark:text-green-400">
            You save ₹{saving.toLocaleString('en-IN', { minimumFractionDigits: 2 })} per unit
          </p>
        </div>
      )}
      {derived != null && derived >= currentPrice && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900/40 text-center">
          <p className="text-xs text-amber-700 dark:text-amber-400">Target price is at or above current price</p>
        </div>
      )}
    </div>
  )
}

export default function RequestQuoteButton({ items, className, label = 'Request Quote' }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [fields, setFields] = useState(() =>
    items.map(item => ({
      quantity: item.quantity || 1,
      unit: item.unit || 'Nos',
      requested_price: '',
      discount_pct: '',
      notes: '',
    }))
  )
  const [overallNotes, setOverallNotes] = useState('')

  if (!user?.isBusiness || user.approvalStatus !== 'approved') return null

  function updateField(i: number, key: string, value: string | number) {
    setFields(prev => prev.map((f, idx) => {
      if (idx !== i) return f
      // mutually exclusive: clearing the other when one is set
      if (key === 'requested_price' && value !== '') return { ...f, requested_price: String(value), discount_pct: '' }
      if (key === 'discount_pct' && value !== '') return { ...f, discount_pct: String(value), requested_price: '' }
      return { ...f, [key]: value }
    }))
  }

  function handleOpen() {
    setFields(items.map(item => ({
      quantity: item.quantity || 1,
      unit: item.unit || 'Nos',
      requested_price: '',
      discount_pct: '',
      notes: '',
    })))
    setOverallNotes('')
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
            requested_price = item.currentPrice * (1 - parseFloat(f.discount_pct) / 100)
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
      router.push('/business/quotes')
    } catch {
      showToast('Failed to submit quote request', 'error')
    } finally {
      setLoading(false)
    }
  }

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

      {open && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !loading && setOpen(false)}
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-surface-elevated border border-border-default rounded-2xl shadow-2xl w-full max-w-xl pointer-events-auto flex flex-col max-h-[92dvh]">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
                <h2 className="text-base font-semibold text-foreground">Request a Quote</h2>
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
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
                {items.map((item, i) => (
                  <div key={i} className={items.length > 1 ? 'pb-5 border-b border-border-default last:border-0 last:pb-0 space-y-3' : 'space-y-3'}>

                    {/* Product label */}
                    <div className="flex items-start gap-3 p-3 bg-surface-secondary rounded-xl">
                      {item.imageUrl ? (
                        <div className="w-16 h-16 rounded-lg border border-border-default bg-surface flex-shrink-0 overflow-hidden">
                          <img src={item.imageUrl} alt={item.description} className="w-full h-full object-contain p-1" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-lg border border-border-default bg-surface flex-shrink-0 flex items-center justify-center">
                          <svg className="w-7 h-7 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground leading-snug">{item.description}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                          {item.brandName && <span className="text-xs text-foreground-muted">{item.brandName}</span>}
                          {item.categoryName && <span className="text-xs text-foreground-muted">{item.categoryName}</span>}
                          {item.sku && <span className="text-xs font-mono text-foreground-muted">SKU: {item.sku}</span>}
                        </div>
                        {item.stockStatus != null && (
                          <span className={`inline-flex items-center gap-1 mt-1 text-[11px] font-medium ${item.stockStatus === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${item.stockStatus === 'in' ? 'bg-green-500' : 'bg-red-500'}`} />
                            {item.stockStatus === 'in' ? 'In Stock' : 'Out of Stock'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity + Unit */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">
                          Quantity <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={fields[i].quantity}
                          onChange={e => updateField(i, 'quantity', e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">Unit</label>
                        <CustomSelect
                          value={fields[i].unit}
                          options={UNIT_OPTIONS}
                          onChange={v => updateField(i, 'unit', v)}
                        />
                      </div>
                    </div>

                    {/* Pricing section */}
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
                              value={fields[i].requested_price}
                              onChange={e => updateField(i, 'requested_price', e.target.value)}
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
                              max={99}
                              step={0.1}
                              value={fields[i].discount_pct}
                              onChange={e => updateField(i, 'discount_pct', e.target.value)}
                              placeholder="e.g. 10"
                              className="w-full pl-3 pr-8 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted text-sm">%</span>
                          </div>
                        </div>
                      </div>

                      {/* Live price breakdown — always shown when price is known */}
                      {item.currentPrice != null && item.currentPrice > 0 && (
                        <PriceBreakdown
                          currentPrice={item.currentPrice}
                          requestedPrice={fields[i].requested_price}
                          discountPct={fields[i].discount_pct}
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
                        value={fields[i].notes}
                        onChange={e => updateField(i, 'notes', e.target.value)}
                        placeholder="e.g. Grade 10.9, stainless, specific tolerance…"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                      />
                    </div>
                  </div>
                ))}

                {/* Overall notes */}
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Additional Notes <span className="text-foreground-muted font-normal">— delivery, urgency, project context</span>
                  </label>
                  <textarea
                    value={overallNotes}
                    onChange={e => setOverallNotes(e.target.value)}
                    rows={3}
                    placeholder="Any other requirements or context for this quote…"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-border-default shrink-0 flex gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
                >
                  {loading && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {loading ? 'Submitting…' : 'Submit Quote Request'}
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
        </>
      )}
    </>
  )
}
