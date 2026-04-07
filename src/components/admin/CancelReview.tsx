'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CancelReview({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleReview = async (action: 'approve' | 'reject') => {
    setIsProcessing(true)
    setResult(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/cancel-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process cancellation review')
      }

      setResult({
        type: 'success',
        message: action === 'approve'
          ? 'Cancellation approved. Order has been cancelled and stock restored.'
          : 'Cancellation rejected. Order has been restored to pending.',
      })

      // Refresh the page after a short delay
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
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {result.message}
        </div>
      )}

      <p className="text-gray-700 mb-4">
        The customer has requested to cancel this order. Please review and approve or reject the cancellation.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleReview('approve')}
          disabled={isProcessing}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-sm transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center"
        >
          {isProcessing ? (
            <>
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
              Processing...
            </>
          ) : (
            'Approve Cancellation'
          )}
        </button>
        <button
          type="button"
          onClick={() => handleReview('reject')}
          disabled={isProcessing}
          className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg font-medium text-sm border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reject (Keep Order)
        </button>
      </div>
    </div>
  )
}
