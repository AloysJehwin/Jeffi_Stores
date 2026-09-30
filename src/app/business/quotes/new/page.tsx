'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { bp } from '@/lib/business-path'

interface RFQItem {
  description: string
  quantity: number
  unit: string
  requested_price: string
  notes: string
}

const emptyItem = (): RFQItem => ({ description: '', quantity: 1, unit: 'Nos', requested_price: '', notes: '' })

export default function NewRFQPage() {
  const router = useRouter()
  const [items, setItems] = useState<RFQItem[]>([emptyItem()])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const updateItem = (i: number, field: keyof RFQItem, value: string | number) => {
    setItems(prev => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)))
  }

  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    const validItems = items.filter(i => i.description.trim())
    if (validItems.length === 0) {
      setError('Add at least one item with a description.')
      return
    }
    setError('')
    setSubmitting(true)
    const res = await fetch('/api/business/rfqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes,
        items: validItems.map((item, i) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity) || 1,
          unit: item.unit,
          requested_price: item.requested_price ? parseFloat(item.requested_price) : null,
          notes: item.notes.trim() || null,
          position: i,
        })),
      }),
    })
    const data = await res.json()
    if (res.ok) {
      router.push(bp('/business/quotes'))
    } else {
      setError(data.error || 'Failed to submit RFQ')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <a href={bp('/business/quotes')} className="text-accent-500 hover:text-accent-600 transition-colors">
          My Quotes
        </a>
        <span>/</span>
        <span className="text-foreground">New RFQ</span>
      </div>

      <h1 className="text-xl font-bold text-foreground">Submit Quote Request</h1>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Items</h2>
          <button
            onClick={addItem}
            className="text-xs font-semibold text-accent-500 hover:text-accent-600 transition-colors"
          >
            + Add Item
          </button>
        </div>

        <div className="divide-y divide-border-default">
          {items.map((item, i) => (
            <div key={i} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground-muted">Item {i + 1}</span>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(i)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Description *</label>
                <input
                  type="text"
                  value={item.description}
                  onChange={e => updateItem(i, 'description', e.target.value)}
                  placeholder="Product name or description"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={e => updateItem(i, 'quantity', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Target Price (₹) <span className="text-foreground-muted font-normal">optional</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={item.requested_price}
                    onChange={e => updateItem(i, 'requested_price', e.target.value)}
                    placeholder="Your target price per unit"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                  <p className="text-[11px] text-foreground-muted mt-1">
                    Maximum discount allowed: 30% off the listed price
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Notes <span className="text-foreground-muted font-normal">optional</span>
                </label>
                <input
                  type="text"
                  value={item.notes}
                  onChange={e => updateItem(i, 'notes', e.target.value)}
                  placeholder="Specifications, grade, brand preference…"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
        <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
          Overall Notes <span className="font-normal normal-case text-foreground-muted">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Delivery requirements, project context, urgency…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-6 py-2.5 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 transition-colors disabled:opacity-60 flex items-center gap-2"
        >
          {submitting && (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          Submit RFQ
        </button>
        <a
          href={bp('/business/quotes')}
          className="px-6 py-2.5 border border-border-default text-sm font-medium rounded-lg hover:bg-surface-secondary transition-colors"
        >
          Cancel
        </a>
      </div>
    </div>
  )
}
