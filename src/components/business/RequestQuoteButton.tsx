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
}

interface Props {
  items: QuoteItem[]
  className?: string
  label?: string
}

const UNITS = ['Nos', 'Pcs', 'Kg', 'g', 'L', 'mL', 'Box', 'Set', 'Pair', 'Roll', 'Sheet', 'Bag']
const UNIT_OPTIONS = UNITS.map(u => ({ value: u, label: u }))

export default function RequestQuoteButton({ items, className, label = 'Request Quote' }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // per-item form state (quantity, unit, target price, notes)
  const [fields, setFields] = useState(() =>
    items.map(item => ({
      quantity: item.quantity || 1,
      unit: item.unit || 'Nos',
      requested_price: '',
      notes: '',
    }))
  )
  const [overallNotes, setOverallNotes] = useState('')

  if (!user?.isBusiness || user.approvalStatus !== 'approved') return null

  function updateField(i: number, key: string, value: string | number) {
    setFields(prev => prev.map((f, idx) => idx === i ? { ...f, [key]: value } : f))
  }

  function handleOpen() {
    // reset fields fresh each time (in case items changed)
    setFields(items.map(item => ({
      quantity: item.quantity || 1,
      unit: item.unit || 'Nos',
      requested_price: '',
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
        items: items.map((item, i) => ({
          productId: item.productId,
          variantId: item.variantId,
          subVariantId: item.subVariantId,
          description: item.description,
          quantity: Number(fields[i].quantity) || 1,
          unit: fields[i].unit,
          requested_price: fields[i].requested_price ? parseFloat(fields[i].requested_price) : null,
          notes: fields[i].notes.trim() || null,
        })),
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
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !loading && setOpen(false)}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-surface-elevated border border-border-default rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto flex flex-col max-h-[90dvh]">

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
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                {items.map((item, i) => (
                  <div key={i} className="space-y-3">
                    {/* Product label */}
                    <div className="flex items-start gap-3 p-3 bg-surface-secondary rounded-xl">
                      <svg className="w-5 h-5 text-accent-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <p className="text-sm font-medium text-foreground leading-snug">{item.description}</p>
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

                    {/* Target price */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        Target Price (₹ per unit) <span className="text-foreground-muted font-normal">— optional</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={fields[i].requested_price}
                        onChange={e => updateField(i, 'requested_price', e.target.value)}
                        placeholder="Your target price"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                      />
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
