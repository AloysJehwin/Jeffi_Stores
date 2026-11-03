'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit/toast'
import { FormButton, TextArea } from '@/components/admin/kit/form'
import AIEnrichButton from '@/components/admin/AIEnrichButton'

export default function CancelReview({ orderId }: { orderId: string }) {
  const router = useRouter()
  const canWrite = useCanWrite('reviews:write')
  const toast = useActionToast()
  const [isProcessing, setIsProcessing] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  const handleReview = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !rejectNote.trim()) return
    setIsProcessing(true)

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

      toast.success(
        action === 'approve'
          ? 'Cancellation approved. Order has been cancelled and stock restored.'
          : 'Cancellation rejected. Customer has been notified with your reason.'
      )

      setTimeout(() => router.refresh(), 1500)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  if (!canWrite) return null

  return (
    <div>
      <p className="mb-4 text-sm text-foreground-secondary">
        The customer has requested to cancel this order. Please review and approve or reject the cancellation.
      </p>

      {showRejectForm ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
              Reason for rejection <span className="text-red-500">*</span>
            </label>
            <AIEnrichButton
              fieldLabel="Reason for rejecting the cancellation"
              value={rejectNote}
              onChange={setRejectNote}
              scope="reviews:write"
              multiline
              context="Sent to the customer explaining why their order cancellation request was declined. Polite, brief, factual."
            >
              <TextArea
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                rows={3}
                placeholder="e.g. Order is already shipped and cannot be cancelled at this stage."
                className="resize-none pr-8"
                disabled={isProcessing}
              />
            </AIEnrichButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <FormButton type="button" onClick={() => handleReview('reject')} disabled={!rejectNote.trim()} pending={isProcessing} pendingLabel="Sending...">
              Confirm Rejection
            </FormButton>
            <FormButton
              type="button"
              variant="secondary"
              onClick={() => {
                setShowRejectForm(false)
                setRejectNote('')
              }}
              disabled={isProcessing}
            >
              Back
            </FormButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <FormButton type="button" onClick={() => handleReview('approve')} pending={isProcessing} pendingLabel="Processing..." className="bg-red-600 hover:bg-red-700">
            Approve Cancellation
          </FormButton>
          <FormButton type="button" variant="secondary" onClick={() => setShowRejectForm(true)} disabled={isProcessing}>
            Reject (Keep Order)
          </FormButton>
        </div>
      )}
    </div>
  )
}
