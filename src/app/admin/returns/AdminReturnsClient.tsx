'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface ReturnRow {
  id: string
  order_id: string
  order_number: string
  type: 'refund' | 'replacement'
  status: string
  reason: string
  description?: string | null
  admin_notes?: string | null
  return_tracking_number?: string | null
  rvp_awb_number?: string | null
  rvp_created_at?: string | null
  received_at?: string | null
  image_urls?: string[] | null
  valuation_status?: string | null
  valuation_condition?: string | null
  valuation_notes?: string | null
  valuated_at?: string | null
  created_at: string
  customer_name?: string | null
  customer_email?: string | null
  first_name?: string | null
  last_name?: string | null
  user_email?: string | null
  total_amount?: number | null
  items: Array<{
    id: string
    order_item_id: string
    product_id?: string | null
    variant_id?: string | null
    quantity: number
    unit_price: number
    refund_amount: number
    product_name?: string | null
    variant_name?: string | null
  }>
}

const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  received: 'Received',
}

const STATUS_COLORS: Record<string, string> = {
  pending_approval: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  approved: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  received: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
}

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  damaged: 'Damaged in transit',
  other: 'Other',
}

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good condition', description: 'Item can be restocked', color: 'green' },
  { value: 'defective', label: 'Defective', description: 'Item cannot be restocked', color: 'red' },
  { value: 'damaged', label: 'Damaged', description: 'Item cannot be restocked', color: 'red' },
]

function customerName(row: ReturnRow) {
  const full = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  return full || row.customer_name || 'Unknown'
}

function ReturnCard({ row, onValuated }: { row: ReturnRow; onValuated: () => void }) {
  const canWrite = useCanWrite('returns:write')
  const [condition, setCondition] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  async function handleValuate() {
    if (!condition) {
      setError('Please select a condition.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/returns/${row.id}/valuate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition, notes: notes.trim() || undefined, restock: condition === 'good' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      onValuated()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isReceived = row.status === 'received'
  const alreadyValuated = row.valuation_status === 'approved'

  return (
    <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface-secondary">
        <div className="flex items-center gap-3">
          <Link
            href={ap(`/admin/orders/${row.order_id}`)}
            className="text-sm font-semibold text-accent-500 hover:text-accent-600 underline"
          >
            #{row.order_number}
          </Link>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700'}`}>
            {STATUS_LABELS[row.status] || row.status}
          </span>
          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-surface border border-border-default text-foreground-secondary capitalize">
            {row.type}
          </span>
        </div>
        <span className="text-xs text-foreground-muted">
          {new Date(row.created_at).toLocaleDateString('en-IN')}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Customer + reason */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-foreground-secondary text-xs mb-0.5">Customer</p>
            <p className="font-medium text-foreground">{customerName(row)}</p>
            <p className="text-foreground-muted text-xs">{row.user_email || row.customer_email || ''}</p>
          </div>
          <div>
            <p className="text-foreground-secondary text-xs mb-0.5">Reason</p>
            <p className="font-medium text-foreground">{REASON_LABELS[row.reason] || row.reason}</p>
          </div>
          {row.rvp_awb_number && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">RVP AWB</p>
              <p className="font-mono text-sm text-foreground">{row.rvp_awb_number}</p>
              {row.rvp_created_at && (
                <p className="text-xs text-foreground-muted">{new Date(row.rvp_created_at).toLocaleDateString('en-IN')}</p>
              )}
            </div>
          )}
          {row.return_tracking_number && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">Return tracking</p>
              <p className="font-mono text-sm text-foreground">{row.return_tracking_number}</p>
            </div>
          )}
          {row.received_at && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">Received at</p>
              <p className="font-medium text-foreground">{new Date(row.received_at).toLocaleDateString('en-IN')}</p>
            </div>
          )}
        </div>

        {/* Returned items */}
        {row.items && row.items.length > 0 && (
          <div>
            <p className="text-xs text-foreground-secondary mb-2">
              Items being returned ({row.items.length}) ·{' '}
              <span className="font-medium text-foreground">
                Total refund: ₹{row.items.reduce((s, i) => s + parseFloat(String(i.refund_amount)), 0).toFixed(0)}
              </span>
            </p>
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
                    <p className="font-medium text-foreground">₹{parseFloat(String(item.refund_amount)).toFixed(0)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer description */}
        {row.description && (          <div>
            <p className="text-xs text-foreground-secondary mb-1">Customer description</p>
            <p className="text-sm text-foreground bg-surface-secondary rounded-lg border border-border-default px-3 py-2">
              {row.description}
            </p>
          </div>
        )}

        {/* Customer images */}
        {row.image_urls && row.image_urls.length > 0 && (
          <div>
            <p className="text-xs text-foreground-secondary mb-2">Customer photos ({row.image_urls.length})</p>
            <div className="flex gap-2 flex-wrap">
              {row.image_urls.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightboxUrl(url)}
                  className="w-20 h-20 rounded-lg overflow-hidden border border-border-default hover:border-accent-500 transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Return photo ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Valuation section — only for received items */}
        {isReceived && (
          <div className="pt-3 border-t border-border-default">
            {alreadyValuated ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-green-800 dark:text-green-300">
                  Valuation complete — <strong className="capitalize">{row.valuation_condition}</strong>
                  {row.valuation_condition === 'good' ? ' (will restock)' : ' (no restock)'}
                  {row.valuated_at && <span className="text-green-700 dark:text-green-400 ml-1">· {new Date(row.valuated_at).toLocaleDateString('en-IN')}</span>}
                </span>
              </div>
            ) : canWrite ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Item Valuation</p>

                {error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                )}

                <div className="grid grid-cols-3 gap-2">
                  {CONDITION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCondition(opt.value)}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium border text-left transition-colors ${
                        condition === opt.value
                          ? opt.color === 'green'
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-red-600 text-white border-red-600'
                          : 'bg-surface text-foreground-secondary border-border-secondary hover:border-accent-400'
                      }`}
                    >
                      <span className="block">{opt.label}</span>
                      <span className="block text-xs mt-0.5 opacity-75">{opt.description}</span>
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Valuation notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. screen cracked, packaging torn..."
                    className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm resize-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleValuate}
                  disabled={isSubmitting || !condition}
                  className="w-full px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Complete Valuation'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Return photo"
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightboxUrl(null)}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

const STATUS_TABS = [
  { key: 'all', label: 'All active' },
  { key: 'pending_approval', label: 'Pending approval' },
  { key: 'history', label: 'History' },
]

export default function AdminReturnsClient() {
  const [activeTab, setActiveTab] = useState('all')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = activeTab === 'history'
        ? `/api/admin/returns?status=history&filter=${historyFilter}`
        : `/api/admin/returns?status=${activeTab}`
      const res = await fetch(url, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setReturns(data.returns)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeTab, historyFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-surface-secondary border border-border-default rounded-lg p-1">
          {STATUS_TABS.map(tab => (
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

        {activeTab === 'history' && (
          <div className="flex gap-1 bg-surface-secondary border border-border-default rounded-lg p-1">
            {[
              { key: 'all', label: 'All' },
              { key: 'approved', label: 'Approved' },
              { key: 'rejected', label: 'Rejected' },
            ].map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setHistoryFilter(f.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  historyFilter === f.key
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-foreground-secondary hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-40 bg-surface border border-border-default rounded-xl animate-pulse" />
          ))}
        </div>
      ) : returns.length === 0 ? (
        <div className="py-16 text-center text-foreground-muted text-sm">
          {activeTab === 'history'
            ? historyFilter === 'approved' ? 'No approved returns'
              : historyFilter === 'rejected' ? 'No rejected returns'
              : 'No completed or rejected returns'
            : 'No active return requests'}
        </div>
      ) : (
        <div className="space-y-3">
          {returns.map(row => (
            <ReturnCard key={row.id} row={row} onValuated={load} />
          ))}
        </div>
      )}
    </div>
  )
}
