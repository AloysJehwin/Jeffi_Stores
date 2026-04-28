'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface InitiateRefundButtonProps {
  orderId: string
  orderNumber: string
  amount: number
}

export default function InitiateRefundButton({ orderId, orderNumber, amount }: InitiateRefundButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()

  async function handleRefund() {
    setIsProcessing(true)
    try {
      const response = await fetch(`/api/orders/${orderId}/refund`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to initiate refund')
      }
      showToast(`Refund of ₹${amount.toLocaleString('en-IN')} initiated for order ${orderNumber}.`, 'success')
      router.refresh()
    } catch (err: any) {
      showToast(err.message || 'Failed to initiate refund. Please try again.', 'error')
    } finally {
      setIsProcessing(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border-2 border-blue-200 dark:border-blue-800">
      <div className="px-6 py-4 border-b border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
        <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-300">Refund Pending</h2>
      </div>
      <div className="p-4 sm:p-6">
        <p className="text-sm text-foreground-secondary mb-4">
          This order was cancelled but the payment of{' '}
          <span className="font-semibold text-foreground">₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>{' '}
          has not yet been refunded. Initiating a refund will trigger it via Razorpay and notify the customer by email.
        </p>

        {showConfirm ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefund}
              disabled={isProcessing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Processing...
                </>
              ) : (
                'Confirm Refund'
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={isProcessing}
              className="px-4 py-2 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
          >
            Initiate Refund ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </button>
        )}
      </div>
    </div>
  )
}
