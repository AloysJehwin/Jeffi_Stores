'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface UpdateOrderStatusProps {
  orderId: string
  currentStatus: string
  currentPaymentStatus: string
}

export default function UpdateOrderStatus({ orderId, currentStatus, currentPaymentStatus }: UpdateOrderStatusProps) {
  const [status, setStatus] = useState(currentStatus)
  const [paymentStatus, setPaymentStatus] = useState(currentPaymentStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const router = useRouter()

  async function handleUpdate() {
    setIsUpdating(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          payment_status: paymentStatus,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update order')
      }

      setSuccess('Order updated successfully')
      router.refresh()
    } catch (err) {
      setError('Failed to update order. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  const hasChanges = status !== currentStatus || paymentStatus !== currentPaymentStatus

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-2">
            Order Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          >
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div>
          <label htmlFor="payment_status" className="block text-sm font-medium text-gray-700 mb-2">
            Payment Status
          </label>
          <select
            id="payment_status"
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          >
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleUpdate}
        disabled={isUpdating || !hasChanges}
        className="w-full px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isUpdating ? 'Updating...' : 'Update Order'}
      </button>
    </div>
  )
}
