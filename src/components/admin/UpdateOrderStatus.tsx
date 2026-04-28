'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminSelect from './AdminSelect'

interface UpdateOrderStatusProps {
  orderId: string
  currentStatus: string
  currentPaymentStatus: string
  currentTrackingUrl?: string | null
}

export default function UpdateOrderStatus({ orderId, currentStatus, currentPaymentStatus, currentTrackingUrl }: UpdateOrderStatusProps) {
  const [status, setStatus] = useState(currentStatus)
  const [paymentStatus, setPaymentStatus] = useState(currentPaymentStatus)
  const [trackingUrl, setTrackingUrl] = useState(currentTrackingUrl || '')
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const router = useRouter()

  async function handleUpdate() {
    if (status === 'shipped' && !trackingUrl.trim()) {
      setError('A tracking URL is required when marking an order as shipped.')
      return
    }

    setIsUpdating(true)
    setError(null)
    setSuccess(null)

    try {
      const body: Record<string, string> = { status, payment_status: paymentStatus }
      if (status === 'shipped' && trackingUrl.trim()) {
        body.tracking_url = trackingUrl.trim()
      }

      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error('Failed to update order')
      }

      const data = await response.json()

      let successMessage = 'Order updated successfully'
      if (data.notifications) {
        const emailsSent = []
        if (data.notifications.statusEmailSent) emailsSent.push('order status')
        if (data.notifications.paymentEmailSent) emailsSent.push('payment status')
        if (emailsSent.length > 0) {
          successMessage += `. Email notification sent for ${emailsSent.join(' and ')} update.`
        }
      }

      setSuccess(successMessage)
      router.refresh()
    } catch {
      setError('Failed to update order. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  const hasChanges = status !== currentStatus || paymentStatus !== currentPaymentStatus ||
    (status === 'shipped' && trackingUrl.trim() !== (currentTrackingUrl || ''))

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-green-800 dark:text-green-300 text-sm">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AdminSelect
          id="status"
          label="Order Status"
          value={status}
          onChange={(val) => setStatus(val)}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'processing', label: 'Processing' },
            { value: 'shipped', label: 'Shipped' },
            { value: 'delivered', label: 'Delivered' },
            { value: 'cancel_requested', label: 'Cancel Requested' },
            { value: 'cancel_rejected', label: 'Cancel Rejected' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />

        <AdminSelect
          id="payment_status"
          label="Payment Status"
          value={paymentStatus}
          onChange={(val) => setPaymentStatus(val)}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'paid', label: 'Paid' },
            { value: 'failed', label: 'Failed' },
            { value: 'refunded', label: 'Refunded' },
          ]}
        />
      </div>

      {status === 'shipped' && (
        <div>
          <label htmlFor="tracking_url" className="block text-sm font-medium text-foreground-secondary mb-2">
            Tracking URL <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            id="tracking_url"
            value={trackingUrl}
            onChange={e => setTrackingUrl(e.target.value)}
            placeholder="https://track.delhivery.com/..."
            className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
          />
          <p className="text-xs text-foreground-muted mt-1">Paste the courier tracking link. This will be shown to the customer on their order page and in the shipment email.</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleUpdate}
        disabled={isUpdating || !hasChanges}
        className="w-full px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isUpdating ? 'Updating...' : 'Update Order'}
      </button>
    </div>
  )
}
