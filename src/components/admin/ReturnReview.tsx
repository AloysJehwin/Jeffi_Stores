'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ReturnRequest {
  id: string
  type: 'refund' | 'replacement'
  status: string
  reason: string
  description?: string | null
  admin_notes?: string | null
  return_tracking_number?: string | null
  replacement_order_id?: string | null
  created_at: string
}

interface ReturnReviewProps {
  orderId: string
  returnRequest: ReturnRequest
  replacementOrderNumber?: string | null
}

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective product',
  wrong_item: 'Wrong item sent',
  not_as_described: 'Not as described',
  damaged: 'Damaged in transit',
  other: 'Other',
}

export default function ReturnReview({ orderId, returnRequest, replacementOrderNumber }: ReturnReviewProps) {
  const [adminNotes, setAdminNotes] = useState('')
  const [returnTrackingNumber, setReturnTrackingNumber] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [refundFailed, setRefundFailed] = useState(false)
  const router = useRouter()

  async function submit(action: string) {
    if (action === 'reject' && !adminNotes.trim()) {
      setError('Please provide a reason for rejection.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)
    setRefundFailed(false)

    try {
      const response = await fetch(`/api/orders/${orderId}/return-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNotes: adminNotes.trim() || undefined, returnTrackingNumber: returnTrackingNumber.trim() || undefined }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed')

      if (action === 'process' && data.refundFailed) {
        setRefundFailed(true)
        setSuccess('Return marked as resolved. Note: Razorpay refund could not be initiated automatically — please issue it manually.')
      } else if (action === 'approve') {
        setSuccess('Return request approved. Customer notified.')
      } else if (action === 'reject') {
        setSuccess('Return request rejected. Customer notified.')
      } else if (action === 'mark_received') {
        setSuccess('Item marked as received. Customer notified.')
      } else if (action === 'process') {
        setSuccess(data.replacementOrderNumber
          ? `Replacement order #${data.replacementOrderNumber} created. Customer notified.`
          : 'Refund processed. Customer notified.')
      }

      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const { status, type, reason, description, admin_notes, return_tracking_number } = returnRequest

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className={`p-3 border rounded-lg text-sm ${refundFailed ? 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300' : 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'}`}>
          {success}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-foreground-secondary">Type</span>
          <p className="font-medium text-foreground capitalize">{type}</p>
        </div>
        <div>
          <span className="text-foreground-secondary">Reason</span>
          <p className="font-medium text-foreground">{REASON_LABELS[reason] || reason}</p>
        </div>
        <div>
          <span className="text-foreground-secondary">Requested</span>
          <p className="font-medium text-foreground">{new Date(returnRequest.created_at).toLocaleDateString('en-IN')}</p>
        </div>
        <div>
          <span className="text-foreground-secondary">Status</span>
          <p className="font-medium text-foreground capitalize">{status.replace(/_/g, ' ')}</p>
        </div>
      </div>

      {description && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Customer description</p>
          <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-3 py-2">{description}</p>
        </div>
      )}

      {admin_notes && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Admin notes</p>
          <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-3 py-2">{admin_notes}</p>
        </div>
      )}

      {return_tracking_number && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Return tracking number</p>
          <p className="text-sm font-mono text-foreground">{return_tracking_number}</p>
        </div>
      )}

      {returnRequest.replacement_order_id && replacementOrderNumber && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Replacement order</p>
          <p className="text-sm text-foreground font-medium">#{replacementOrderNumber}</p>
        </div>
      )}

      {status === 'pending_approval' && (
        <div className="space-y-3 pt-2 border-t border-border-default">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Admin notes (required for rejection, optional for approval)
            </label>
            <textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={3}
              placeholder="Notes visible to customer..."
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => submit('approve')}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : 'Approve Return'}
            </button>
            <button
              type="button"
              onClick={() => submit('reject')}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : 'Reject Return'}
            </button>
          </div>
        </div>
      )}

      {status === 'approved' && (
        <div className="space-y-3 pt-2 border-t border-border-default">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Return tracking number (optional)
            </label>
            <input
              type="text"
              value={returnTrackingNumber}
              onChange={e => setReturnTrackingNumber(e.target.value)}
              placeholder="e.g. 123456789012"
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => submit('mark_received')}
            disabled={isSubmitting}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Processing...' : 'Mark Item as Received'}
          </button>
        </div>
      )}

      {status === 'received' && (
        <div className="pt-2 border-t border-border-default">
          <p className="text-sm text-foreground-secondary mb-3">
            {type === 'refund'
              ? 'Issue a full refund via Razorpay and restore stock.'
              : 'Create a replacement order (confirmed, paid) and restore stock for the returned items.'}
          </p>
          <button
            type="button"
            onClick={() => submit('process')}
            disabled={isSubmitting}
            className="w-full px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Processing...' : type === 'refund' ? 'Process Refund' : 'Create Replacement Order'}
          </button>
        </div>
      )}
    </div>
  )
}
