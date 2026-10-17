'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Card } from '@/components/admin/kit/layout'
import { FormButton } from '@/components/admin/kit/form'

interface InitiateRefundButtonProps {
  orderId: string
  orderNumber: string
  amount: number
  isReturn?: boolean
  /** Defaults to the order's full refund; product adjustments pass their own refund route. */
  endpoint?: string
  heading?: string
  description?: string
}

export default function InitiateRefundButton({ orderId, orderNumber, amount, isReturn, endpoint, heading, description }: InitiateRefundButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()

  async function handleRefund() {
    setIsProcessing(true)
    try {
      const response = await fetch(endpoint ?? `/api/orders/${orderId}/refund`, {
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
    <Card title={<span className="text-blue-600 dark:text-blue-400">{heading ?? 'Refund Pending'}</span>}>
        <p className="text-sm text-foreground-secondary mb-4">
          {description ? (
            <>{description} <span className="font-semibold text-foreground">₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>.</>
          ) : (<>
          This order was {isReturn ? 'returned' : 'cancelled'} but the payment of{' '}
          <span className="font-semibold text-foreground">
            ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>{' '}
          has not yet been refunded. Initiating a refund will trigger it via Razorpay and notify the customer by email.
          </>)}
        </p>

        {showConfirm ? (
          <RequireWrite scope="orders:write">
            <div className="flex flex-wrap items-center gap-2">
              <FormButton type="button" onClick={handleRefund} pending={isProcessing} pendingLabel="Processing...">
                Confirm Refund
              </FormButton>
              <FormButton type="button" variant="secondary" onClick={() => setShowConfirm(false)} disabled={isProcessing}>
                Cancel
              </FormButton>
            </div>
          </RequireWrite>
        ) : (
          <RequireWrite scope="orders:write">
            <FormButton type="button" onClick={() => setShowConfirm(true)}>
              Initiate Refund ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </FormButton>
          </RequireWrite>
        )}
    </Card>
  )
}
