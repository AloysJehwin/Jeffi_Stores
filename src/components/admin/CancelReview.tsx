'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CancelReview({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  const handleReview = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !rejectNote.trim()) return
    setIsProcessing(true)
    setResult(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/cancel-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: action === 'reject' ? rejectNote.trim() : undefined }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process cancellation review')
      }

      setResult({
        type: 'success',
        message: action === 'approve'
          ? 'Cancellation approved. Order has been cancelled and stock restored.'
          : 'Cancellation rejected. Customer has been notified with your reason.',
      })

      setTimeout(() => router.refresh(), 1500)
    } catch (err: any) {
      setResult({ type: 'error', message: err.message })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div>
      {result && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          result.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
        }`}>
          {result.message}
        </div>
      )}

      <p className="text-foreground-secondary mb-4">
        The customer has requested to cancel this order. Please review and approve or reject the cancellation.
      </p>

      {showRejectForm ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Reason for rejection <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              rows={3}
              placeholder="e.g. Order is already shipped and cannot be cancelled at this stage."
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent resize-none"
              disabled={isProcessing}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleReview('reject')}
              disabled={isProcessing || !rejectNote.trim()}
              className="px-4 py-2 bg-secondary-600 hover:bg-secondary-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Sending...
                </>
              ) : (
                'Confirm Rejection'
              )}
            </button>
            <button
              type="button"
              onClick={() => { setShowRejectForm(false); setRejectNote('') }}
              disabled={isProcessing}
              className="px-4 py-2 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleReview('approve')}
            disabled={isProcessing}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-sm transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Processing...
              </>
            ) : (
              'Approve Cancellation'
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            disabled={isProcessing}
            className="px-4 py-2 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject (Keep Order)
          </button>
        </div>
      )}
    </div>
  )
}
