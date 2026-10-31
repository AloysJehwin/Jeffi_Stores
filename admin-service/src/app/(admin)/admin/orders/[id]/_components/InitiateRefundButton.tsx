'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Card } from '@/components/admin/kit/layout'
import { FormButton } from '@/components/admin/kit/form'
import ExternalRefundForm from './ExternalRefundForm'

interface InitiateRefundButtonProps {
  orderId: string
  orderNumber: string
  amount: number
  isReturn?: boolean
  /** Defaults to the order's full refund; product adjustments pass their own refund route. */
  endpoint?: string
  heading?: string
  description?: string
  /** A completed Razorpay payment can take the refund; otherwise it can only be recorded. */
  gateway?: boolean
  /** Order refunds: the admin sets the amount recorded and can email the customer. */
  orderRefund?: boolean
}

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function InitiateRefundButton({ orderId, orderNumber, amount, isReturn, endpoint, heading, description, gateway = true, orderRefund = !endpoint }: InitiateRefundButtonProps) {
  const [mode, setMode] = useState<'idle' | 'confirm' | 'external'>('idle')
  const [isProcessing, setIsProcessing] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()
  const url = endpoint ?? `/api/orders/${orderId}/refund`

  async function handleRefund() {
    setIsProcessing(true)
    try {
      const response = await fetch(url, {
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
      setMode('idle')
    }
  }

  return (
    <Card title={<span className="text-blue-600 dark:text-blue-400">{heading ?? 'Refund Pending'}</span>}>
      <p className="text-sm text-foreground-secondary mb-4">
        {description ? (
          <>
            {description} <span className="font-semibold text-foreground">₹{money(amount)}</span>.
          </>
        ) : (
          <>
            This order was {isReturn ? 'returned' : 'cancelled'} but the payment of <span className="font-semibold text-foreground">₹{money(amount)}</span> has not
            yet been refunded.{' '}
            {gateway
              ? 'Initiating a refund will trigger it via Razorpay and notify the customer by email. If the money already went back another way (a Razorpay dispute, the Razorpay dashboard, bank transfer), record it instead.'
              : 'It was not collected through Razorpay (COD, cash or marked paid by hand), so refund the customer directly and record it here.'}
          </>
        )}
      </p>

      <RequireWrite scope="orders:write">
        {mode === 'external' ? (
          <ExternalRefundForm
            endpoint={url}
            amount={amount}
            razorpayPaid={gateway}
            amountEditable={orderRefund}
            notifyOption={orderRefund}
            onCancel={() => setMode('idle')}
          />
        ) : mode === 'confirm' ? (
          <div className="flex flex-wrap items-center gap-2">
            <FormButton type="button" onClick={handleRefund} pending={isProcessing} pendingLabel="Processing...">
              Confirm Refund
            </FormButton>
            <FormButton type="button" variant="secondary" onClick={() => setMode('idle')} disabled={isProcessing}>
              Cancel
            </FormButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {gateway ? (
              <FormButton type="button" onClick={() => setMode('confirm')}>
                Initiate Refund ₹{money(amount)}
              </FormButton>
            ) : null}
            <FormButton type="button" variant={gateway ? 'secondary' : 'primary'} onClick={() => setMode('external')}>
              {gateway ? 'Refunded another way' : `Mark as refunded ₹${money(amount)}`}
            </FormButton>
          </div>
        )}
      </RequireWrite>
    </Card>
  )
}
