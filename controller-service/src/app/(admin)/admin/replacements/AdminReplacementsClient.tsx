'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { Dialog, EmptyState, ErrorState, TextArea, TableSkeleton, badgeCls, type Tone } from '@/components/admin/kit'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { fmtQty } from '@/lib/shared/number-display'

interface ReplacementRow {
  id: string
  order_id: string
  order_number: string
  type: 'replacement'
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
  replacement_order_id?: string | null
  replacement_order_number?: string | null
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

const STATUS_TONE: Record<string, Tone> = { pending_approval: 'amber', approved: 'blue', received: 'blue', completed: 'green', rejected: 'red' }

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  damaged: 'Damaged in transit',
  other: 'Other',
}

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good condition', description: 'Can send replacement', color: 'green' },
  { value: 'defective', label: 'Defective', description: 'Cannot send replacement', color: 'red' },
  { value: 'damaged', label: 'Damaged', description: 'Cannot send replacement', color: 'red' },
]

const STATUS_TABS = [
  { key: 'all', label: 'All active' },
  { key: 'pending_approval', label: 'Pending approval' },
  { key: 'history', label: 'History' },
]

function customerName(row: ReplacementRow) {
  const full = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  return full || row.customer_name || 'Unknown'
}

function ReplacementCard({ row, onValuated }: { row: ReplacementRow; onValuated: () => void }) {
  const canWrite = useCanWrite('replacements:write')
  const [condition, setCondition] = useState<string>('')
  const [notes, setNotes] = useState('')
  const toast = useActionToast()
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
      toast.success('Valuation saved.')
      onValuated()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isReceived = row.status === 'received'
  const alreadyValuated = row.valuation_status === 'approved'
  const isCompleted = row.status === 'completed'
  const isRejected = row.status === 'rejected'

  return (
    <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface-secondary">
        <div className="flex items-center gap-3">
          <Link
            href={ap(`/admin/orders/${row.order_id}/view`)}
            className="text-sm font-semibold text-accent-500 hover:text-accent-600 underline"
          >
            #{row.order_number}
          </Link>
          <span
            className={badgeCls(STATUS_TONE[row.status] ?? 'muted')}
          >
            {STATUS_LABELS[row.status] || row.status}
          </span>
          <span className={badgeCls('amber')}>
            Replacement
          </span>
        </div>
        <span className="text-xs text-foreground-muted">{new Date(row.created_at).toLocaleDateString('en-IN')}</span>
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
                <p className="text-xs text-foreground-muted">
                  {new Date(row.rvp_created_at).toLocaleDateString('en-IN')}
                </p>
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
          {row.replacement_order_id && row.replacement_order_number && (
            <div>
              <p className="text-foreground-secondary text-xs mb-0.5">Replacement order</p>
              <Link
                href={ap(`/admin/orders/${row.replacement_order_id}/view`)}
                className="text-sm font-medium text-accent-500 hover:text-accent-600 underline"
              >
                #{row.replacement_order_number}
              </Link>
            </div>
          )}
        </div>

        {/* Items */}
        {row.items && row.items.length > 0 && (
          <div>
            <p className="text-xs text-foreground-secondary mb-2">
              Items for replacement ({row.items.length}) ·{' '}
              <span className="font-medium text-foreground">
                Value: ₹{row.items.reduce((s, i) => s + parseFloat(String(i.refund_amount)), 0).toFixed(0)}
              </span>
            </p>
            <div className="divide-y divide-border-default border border-border-default rounded-lg overflow-hidden">
              {row.items.map(item => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-surface text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{item.product_name}</p>
                    {item.variant_name && <p className="text-xs text-foreground-secondary">{item.variant_name}</p>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-foreground-secondary text-xs">
                      Qty {fmtQty(item.quantity)} × ₹{parseFloat(String(item.unit_price)).toFixed(0)}
                    </p>
                    <p className="font-medium text-foreground">₹{parseFloat(String(item.refund_amount)).toFixed(0)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer description */}
        {row.description && (
          <div>
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
                  <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Completed — show replacement order */}
        {isCompleted && row.replacement_order_id && (
          <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                <span className="text-foreground">
              Replacement order{' '}
              <Link href={ap(`/admin/orders/${row.replacement_order_id}/view`)} className="underline font-medium">
                #{row.replacement_order_number}
              </Link>{' '}
              created and confirmed.
            </span>
          </div>
        )}

        {/* Rejected */}
        {isRejected && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-foreground">
            Rejected{row.admin_notes ? `: ${row.admin_notes}` : ''}
          </div>
        )}

        {/* Valuation section — only for received items */}
        {isReceived && (
          <div className="pt-3 border-t border-border-default">
            {alreadyValuated ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                <span className="text-foreground">
                  Valuation complete — <strong className="capitalize">{row.valuation_condition}</strong>
                  {row.valuation_condition === 'good' ? ' (replacement can be sent)' : ' (cannot send replacement)'}
                  {row.valuated_at && (
                    <span className="ml-1 text-foreground-muted">
                      · {new Date(row.valuated_at).toLocaleDateString('en-IN')}
                    </span>
                  )}
                </span>
              </div>
            ) : canWrite ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Item Valuation</p>
                {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
                <div className="grid grid-cols-3 gap-2">
                  {CONDITION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCondition(opt.value)}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium border text-left transition-colors ${
                        condition === opt.value
                          ? opt.color === 'green'
                            ? 'border-green-600 bg-green-600 text-white'
                            : 'border-red-600 bg-red-600 text-white'
                          : 'border-border-secondary bg-surface text-foreground-secondary hover:border-accent-500'
                      }`}
                    >
                      <span className="block">{opt.label}</span>
                      <span className="block text-xs mt-0.5 opacity-75">{opt.description}</span>
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Notes (optional)</label>
                  <TextArea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. screen cracked, packaging torn..."
                    className="resize-none"
                    />
                </div>
                <button
                  type="button"
                  onClick={handleValuate}
                  disabled={isSubmitting || !condition}
                  className="control-md w-full justify-center bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Complete Valuation'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onClose={() => setLightboxUrl(null)} title="Return photo" size="xl">
        {lightboxUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lightboxUrl} alt="Return photo" className="mx-auto max-h-[70vh] rounded-lg object-contain" />
        )}
      </Dialog>
    </div>
  )
}

export default function AdminReplacementsClient() {
  const [activeTab, setActiveTab] = useState('all')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [replacements, setReplacements] = useState<ReplacementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url =
        activeTab === 'history'
          ? `/api/admin/replacements?status=history&filter=${historyFilter}`
          : `/api/admin/replacements?status=${activeTab}`
      const res = await fetch(url, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setReplacements(data.replacements)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeTab, historyFilter])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex h-control items-stretch gap-1 rounded-lg border border-border-default bg-surface-secondary p-0.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md px-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-surface-elevated text-foreground shadow-sm'
                  : 'text-foreground-secondary hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'history' && (
          <div className="flex h-control items-stretch gap-1 rounded-lg border border-border-default bg-surface-secondary p-0.5">
            {[
              { key: 'all', label: 'All' },
              { key: 'approved', label: 'Approved' },
              { key: 'rejected', label: 'Rejected' },
            ].map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setHistoryFilter(f.key)}
                className={`rounded-md px-3 text-sm font-medium transition-colors ${
                  historyFilter === f.key
                    ? 'bg-surface-elevated text-foreground shadow-sm'
                    : 'text-foreground-secondary hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>


      {loading ? (
        <TableSkeleton rows={3} cols={4} />
      ) : error ? (
        <ErrorState body={error} />
      ) : replacements.length === 0 ? (
        <EmptyState
          title={activeTab === 'history'
            ? historyFilter === 'approved'
              ? 'No approved replacements'
              : historyFilter === 'rejected'
                ? 'No rejected replacements'
                : 'No completed or rejected replacements'
            : 'No active replacement requests'}
        />
      ) : (
        <div className="space-y-3">
          {replacements.map(row => (
            <ReplacementCard key={row.id} row={row} onValuated={load} />
          ))}
        </div>
      )}
    </div>
  )
}
