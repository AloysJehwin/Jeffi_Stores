'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'

interface ReplacementRow {
  id: string
  order_number: string
  status: string
  payment_status: string
  total_amount: number
  created_at: string
  shipped_at?: string | null
  delivered_at?: string | null
  awb_number?: string | null
  shipment_status?: string | null
  customer_name?: string | null
  customer_email?: string | null
  original_order_id: string
  original_order_number: string
  first_name?: string | null
  last_name?: string | null
  user_email?: string | null
  return_request_id?: string | null
  return_type?: string | null
  reason?: string | null
  items: Array<{
    id: string
    product_name: string
    variant_name?: string | null
    quantity: number
    unit_price: number
    total_price: number
  }>
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  processing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  shipped: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
  out_for_delivery: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
  delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
  returned: 'bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  damaged: 'Damaged in transit',
  other: 'Other',
}

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'all', label: 'All' },
]

function customerName(row: ReplacementRow) {
  const full = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  return full || row.customer_name || 'Unknown'
}

function ReplacementCard({ row }: { row: ReplacementRow }) {
  return (
    <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface-secondary">
        <div className="flex items-center gap-3">
          <Link
            href={ap(`/admin/orders/${row.id}`)}
            className="text-sm font-semibold text-accent-500 hover:text-accent-600 underline"
          >
            #{row.order_number}
          </Link>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] || 'bg-surface-secondary text-foreground'}`}>
            {STATUS_LABELS[row.status] || row.status}
          </span>
          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
            Replacement
          </span>
        </div>
        <span className="text-xs text-foreground-muted">
          {new Date(row.created_at).toLocaleDateString('en-IN')}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-foreground-secondary text-xs mb-0.5">Customer</p>
            <p className="font-medium text-foreground">{customerName(row)}</p>
            <p className="text-foreground-muted text-xs">{row.user_email || row.customer_email || ''}</p>
          </div>
          <div>
            <p className="text-foreground-secondary text-xs mb-0.5">Original Order</p>
            <Link
              href={ap(`/admin/orders/${row.original_order_id}`)}
              className="text-sm font-medium text-accent-500 hover:text-accent-600 underline"
            >
              #{row.original_order_number}
            </Link>
          </div>
          {row.reason && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">Return reason</p>
              <p className="font-medium text-foreground">{REASON_LABELS[row.reason] || row.reason}</p>
            </div>
          )}
          {row.awb_number && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">AWB</p>
              <p className="font-mono text-sm text-foreground">{row.awb_number}</p>
            </div>
          )}
          {row.delivered_at && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">Delivered</p>
              <p className="font-medium text-foreground">{new Date(row.delivered_at).toLocaleDateString('en-IN')}</p>
            </div>
          )}
        </div>

        {/* Items */}
        {row.items && row.items.length > 0 && (
          <div className="divide-y divide-border-default border border-border-default rounded-lg overflow-hidden">
            {row.items.map(item => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-surface text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{item.product_name}</p>
                  {item.variant_name && (
                    <p className="text-xs text-foreground-secondary">{item.variant_name}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-foreground-secondary text-xs">Qty {item.quantity} × ₹{parseFloat(String(item.unit_price)).toFixed(0)}</p>
                  <p className="font-medium text-foreground">₹{parseFloat(String(item.total_price)).toFixed(0)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No shipment warning */}
        {['confirmed', 'processing'].includes(row.status) && !row.awb_number && (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            No shipment created yet — assign an AWB from the{' '}
            <Link href={ap(`/admin/orders/${row.id}`)} className="underline font-medium">order page</Link>.
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminReplacementsClient() {
  const [activeTab, setActiveTab] = useState('active')
  const [replacements, setReplacements] = useState<ReplacementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/replacements?status=${activeTab}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setReplacements(data.replacements)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-surface-secondary border border-border-default rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-surface border border-border-default rounded-xl animate-pulse" />
          ))}
        </div>
      ) : replacements.length === 0 ? (
        <div className="py-16 text-center text-foreground-muted text-sm">
          No replacement orders
        </div>
      ) : (
        <div className="space-y-3">
          {replacements.map(row => (
            <ReplacementCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}
