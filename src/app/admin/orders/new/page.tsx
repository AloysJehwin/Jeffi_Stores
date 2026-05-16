'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LineItemsSection, { newLineItem, type LineItem } from '@/components/admin/LineItemsSection'

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function NewOfflineOrderPage() {
  const router = useRouter()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [buyerGstin, setBuyerGstin] = useState('')
  const [paymentMode, setPaymentMode] = useState<'cash' | 'upi' | 'credit'>('cash')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([newLineItem()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ orderId: string; orderNumber: string; invoiceNumber: string | null; invoiceUrl: string | null } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) { setError('Customer name is required'); return }
    if (items.some(it => !it.product_name.trim() || !it.unit_price)) { setError('All line items need a name and price'); return }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/orders/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName, customerPhone, customerEmail,
          addressLine1, addressLine2, city, state, postalCode,
          buyerGstin, paymentMode, notes,
          items: items.map(it => ({
            product_id: it.product_id,
            product_name: it.product_name,
            product_sku: it.product_sku,
            variant_id: it.variant_id,
            variant_name: it.variant_name,
            hsn_code: it.hsn_code,
            gst_rate: it.gst_rate,
            quantity: it.quantity,
            unit_price: it.unit_price,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed'); return }
      setSuccess(data)
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="bg-surface-elevated rounded-lg shadow p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground">Order Created</h2>
          <p className="text-foreground-secondary">Order <strong>{success.orderNumber}</strong> has been created successfully.</p>
          {success.invoiceNumber && (
            <p className="text-sm text-foreground-secondary">Invoice <strong>{success.invoiceNumber}</strong> generated.</p>
          )}
          <div className="flex flex-wrap gap-3 justify-center pt-2">
            {success.invoiceUrl && (
              <a
                href={success.invoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded text-sm font-medium"
              >
                Download Invoice PDF
              </a>
            )}
            <a
              href={`/admin/orders/${success.orderId}`}
              className="px-4 py-2 bg-surface border border-border-default rounded text-sm font-medium text-foreground"
            >
              View Order
            </a>
            <button
              onClick={() => {
                setSuccess(null)
                setCustomerName(''); setCustomerPhone(''); setCustomerEmail('')
                setAddressLine1(''); setAddressLine2(''); setCity(''); setState(''); setPostalCode('')
                setBuyerGstin(''); setPaymentMode('cash'); setNotes('')
                setItems([newLineItem()])
              }}
              className="px-4 py-2 bg-surface border border-border-default rounded text-sm font-medium text-foreground"
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">New Offline Order</h1>
        <p className="text-foreground-secondary text-sm mt-1">Walk-in, credit sale, or B2B bulk order</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-foreground">Customer Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">Customer Name *</label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                required
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">Phone</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="+91 XXXXX XXXXX"
              />
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">Email</label>
              <input
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="customer@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">Buyer GSTIN (optional)</label>
              <input
                type="text"
                value={buyerGstin}
                onChange={e => setBuyerGstin(e.target.value.toUpperCase())}
                maxLength={15}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground font-mono"
                placeholder="29XXXXX..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-foreground-secondary mb-1">Address Line 1</label>
              <input
                type="text"
                value={addressLine1}
                onChange={e => setAddressLine1(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="Street address"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-foreground-secondary mb-1">Address Line 2</label>
              <input
                type="text"
                value={addressLine2}
                onChange={e => setAddressLine2(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="Apt, suite, etc."
              />
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">State</label>
              <input
                type="text"
                value={state}
                onChange={e => setState(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="Tamil Nadu"
              />
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">Postal Code</label>
              <input
                type="text"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
              />
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
          <LineItemsSection items={items} onChange={setItems} />
        </div>

        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-foreground">Payment &amp; Notes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-foreground-secondary mb-2">Payment Mode</label>
              <div className="flex gap-3">
                {(['cash', 'upi', 'credit'] as const).map(mode => (
                  <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMode"
                      value={mode}
                      checked={paymentMode === mode}
                      onChange={() => setPaymentMode(mode)}
                      className="accent-accent-500"
                    />
                    <span className="text-sm text-foreground capitalize">{mode}</span>
                  </label>
                ))}
              </div>
              {paymentMode === 'credit' && (
                <p className="text-xs text-yellow-600 mt-1">Payment status will be set to Unpaid (credit sale)</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-foreground-secondary mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-border-default rounded px-3 py-2 text-sm bg-surface text-foreground"
                placeholder="Any additional notes..."
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Order & Generate Invoice'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-surface border border-border-default rounded-lg text-sm font-medium text-foreground"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
