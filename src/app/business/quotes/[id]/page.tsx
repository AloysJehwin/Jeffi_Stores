'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { bp } from '@/lib/business-path'

interface RFQItem {
  id: string
  description: string
  quantity: number
  unit: string
  requested_price: number | null
  notes: string | null
}

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  admin_note: string | null
  created_at: string
  converted_quotation_id: string | null
  quotation_view_token: string | null
  quote_number: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-400/20 text-yellow-600 dark:text-yellow-300',
  reviewed:  'bg-blue-400/20 text-blue-600 dark:text-blue-300',
  converted: 'bg-green-400/20 text-green-600 dark:text-green-300',
  rejected:  'bg-red-400/20 text-red-600 dark:text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending Review',
  reviewed: 'Under Review',
  converted: 'Quotation Ready',
  rejected: 'Rejected',
}

export default function BusinessRFQDetail({ params }: { params: { id: string } }) {
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/business/rfqs/${params.id}`)
      .then(r => r.json())
      .then(d => { setRfq(d.rfq); setItems(d.items || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [params.id])

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
    </div>
  )

  if (!rfq) return <div className="text-center text-foreground-muted py-16">Quote not found.</div>

  const totalRequested = items.reduce((sum, i) => sum + (i.requested_price ? i.requested_price * i.quantity : 0), 0)

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={bp('/business/quotes')} className="text-accent-500 hover:text-accent-600 transition-colors">My Quotes</Link>
        <span>/</span>
        <span className="text-foreground font-mono">{rfq.rfq_number}</span>
      </div>

      <div className="bg-zinc-800 rounded-2xl p-5 text-white border border-zinc-700">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold font-mono">{rfq.rfq_number}</h1>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || 'bg-zinc-500/20 text-zinc-300'}`}>
                {STATUS_LABEL[rfq.status] || rfq.status}
              </span>
            </div>
            <p className="text-zinc-400 text-xs mt-1">
              Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          {rfq.status === 'converted' && rfq.quotation_view_token && (
            <a href={`https://quotation.jeffistores.in/${rfq.quotation_view_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 border border-accent-500 text-accent-400 text-sm font-semibold rounded-lg hover:bg-accent-900/20 transition-colors shrink-0">
              View Quotation →
            </a>
          )}
        </div>

        {rfq.status === 'rejected' && rfq.admin_note && (
          <div className="mt-4 bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
            <p className="font-semibold mb-1">Reason:</p>
            <p className="font-normal">{rfq.admin_note}</p>
          </div>
        )}
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Requested Items</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default">
              <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted w-8">#</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted">Description</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Qty</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Target Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {items.map((item, i) => (
              <tr key={item.id}>
                <td className="px-5 py-3.5 text-foreground-muted font-mono text-xs">{i + 1}</td>
                <td className="px-5 py-3.5">
                  <p className="font-medium text-foreground">{item.description}</p>
                  {item.notes && <p className="text-xs text-foreground-muted italic mt-0.5">{item.notes}</p>}
                </td>
                <td className="px-5 py-3.5 text-right text-foreground">
                  {item.quantity} <span className="text-foreground-muted">{item.unit}</span>
                </td>
                <td className="px-5 py-3.5 text-right text-foreground">
                  {item.requested_price != null
                    ? `₹${Number(item.requested_price).toLocaleString('en-IN')}`
                    : <span className="text-foreground-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {totalRequested > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border-default bg-surface-secondary/40">
                <td colSpan={3} className="px-5 py-3 text-right text-sm font-semibold text-foreground-secondary">Total Target Value</td>
                <td className="px-5 py-3 text-right font-bold text-foreground">₹{totalRequested.toLocaleString('en-IN')}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {rfq.notes && (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Your Notes</h2>
          <p className="text-sm text-foreground">{rfq.notes}</p>
        </div>
      )}
    </div>
  )
}
