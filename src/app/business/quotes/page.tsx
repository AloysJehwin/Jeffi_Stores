'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface RFQ {
  id: string
  rfq_number: string
  status: string
  created_at: string
  item_count: number
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-400/20 text-yellow-600 dark:text-yellow-300',
  reviewed:  'bg-blue-400/20 text-blue-600 dark:text-blue-300',
  converted: 'bg-green-400/20 text-green-600 dark:text-green-300',
  rejected:  'bg-red-400/20 text-red-600 dark:text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  converted: 'Converted',
  rejected: 'Rejected',
}

export default function BusinessQuotesPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/business/rfqs')
      .then(r => r.json())
      .then(d => { setRfqs(d.rfqs || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">My Quotes (RFQs)</h1>
        <Link href="/business/quotes/new"
          className="px-4 py-2 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 transition-colors">
          + New RFQ
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
        </div>
      ) : rfqs.length === 0 ? (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-8 text-center space-y-3">
          <p className="text-foreground-muted">No quotes yet.</p>
          <Link href="/business/quotes/new"
            className="inline-block px-5 py-2 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 transition-colors">
            Submit your first RFQ
          </Link>
        </div>
      ) : (
        <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted">RFQ #</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Items</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {rfqs.map(rfq => (
                <tr key={rfq.id} className="hover:bg-surface-secondary/50 transition-colors cursor-pointer"
                  onClick={() => window.location.href = `/business/quotes/${rfq.id}`}>
                  <td className="px-5 py-3.5 font-mono font-medium text-foreground">{rfq.rfq_number}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[rfq.status] || 'bg-zinc-400/20 text-zinc-500'}`}>
                      {STATUS_LABEL[rfq.status] || rfq.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-foreground-secondary">{rfq.item_count}</td>
                  <td className="px-5 py-3.5 text-right text-foreground-secondary">
                    {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
