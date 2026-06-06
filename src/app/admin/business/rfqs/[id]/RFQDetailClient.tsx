'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface RFQItem {
  id: string
  description: string
  quantity: number
  unit: string
  notes: string | null
  position: number
  product_name: string | null
  variant_name: string | null
}

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  created_at: string
  converted_quotation_id: string | null
  company_name: string
  first_name: string
  last_name: string | null
  email: string
  user_id: string
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

export default function RFQDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    fetch(`/api/admin/business/rfqs/${id}`)
      .then(r => r.json())
      .then(d => {
        setRfq(d.rfq)
        setItems(d.items || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const handleConvert = async () => {
    if (!confirm('Convert this RFQ to a quotation (with rate = 0)? You can fill in the rates afterwards.')) return
    setConverting(true)
    const res = await fetch(`/api/admin/business/rfqs/${id}/convert-to-quotation`, {
      method: 'POST',
    })
    const data = await res.json()
    if (res.ok) {
      setRfq(r => r ? { ...r, status: 'converted', converted_quotation_id: data.quotationId } : r)
      showToast(`Quotation ${data.quoteNumber} created successfully`)
    } else {
      showToast(data.error || 'Failed to convert', 'error')
    }
    setConverting(false)
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!rfq) {
    return <div className="p-6 text-center text-foreground-muted">RFQ not found.</div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={() => router.back()} className="text-sm text-foreground-muted hover:text-foreground mb-2 flex items-center gap-1">
            ← Back to RFQs
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground font-mono">{rfq.rfq_number}</h1>
            <span className={`px-3 py-1 text-sm font-semibold rounded-full ${STATUS_STYLES[rfq.status] || ''}`}>
              {rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
            </span>
          </div>
          <p className="text-sm text-foreground-secondary mt-1">
            Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>

        {/* Action */}
        {rfq.status !== 'converted' && rfq.status !== 'rejected' && (
          <button
            onClick={handleConvert}
            disabled={converting}
            className="px-5 py-2.5 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {converting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Convert to Quotation
          </button>
        )}
        {rfq.status === 'converted' && rfq.converted_quotation_id && (
          <Link
            href={`/admin/quotations/${rfq.converted_quotation_id}`}
            className="px-5 py-2.5 border-2 border-accent-500 text-accent-600 dark:text-accent-400 text-sm font-semibold rounded-lg hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
          >
            View Quotation →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Company info */}
        <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">From</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-3">
              <dt className="text-foreground-muted w-20 shrink-0">Company</dt>
              <dd className="font-medium text-foreground">{rfq.company_name || '—'}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-foreground-muted w-20 shrink-0">Contact</dt>
              <dd className="text-foreground">{rfq.first_name} {rfq.last_name || ''}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-foreground-muted w-20 shrink-0">Email</dt>
              <dd className="text-foreground">{rfq.email}</dd>
            </div>
          </dl>
        </div>

        {/* Notes */}
        {rfq.notes && (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">Customer Notes</h2>
            <p className="text-sm text-foreground">{rfq.notes}</p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-surface-elevated rounded-lg border border-border-default">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">
            Requested Items ({items.length})
          </h2>
        </div>
        <div className="divide-y divide-border-default">
          {items.length === 0 ? (
            <p className="p-5 text-sm text-foreground-muted">No items found.</p>
          ) : items.map((item, i) => (
            <div key={item.id} className="px-5 py-4 flex items-start gap-4">
              <span className="text-xs text-foreground-muted font-mono w-5 shrink-0 mt-0.5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{item.description}</p>
                {item.notes && <p className="text-xs text-foreground-muted mt-0.5">{item.notes}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-foreground">{item.quantity} <span className="font-normal text-foreground-secondary">{item.unit}</span></p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {rfq.status === 'converted' && rfq.converted_quotation_id && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 flex items-center justify-between">
          <p className="text-sm text-green-700 dark:text-green-400 font-medium">This RFQ has been converted to a quotation.</p>
          <Link
            href={`/admin/quotations/${rfq.converted_quotation_id}`}
            className="text-sm font-semibold text-accent-600 dark:text-accent-400 hover:underline"
          >
            Open Quotation →
          </Link>
        </div>
      )}
    </div>
  )
}
