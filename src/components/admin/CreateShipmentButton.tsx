'use client'

import { useState } from 'react'

export default function CreateShipmentButton({ orderId, awbNumber }: { orderId: string; awbNumber?: string | null }) {
  const [loading, setLoading] = useState(false)
  const [awb, setAwb] = useState<string | null>(awbNumber || null)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!confirm('Register this order with Delhivery and generate an AWB number?')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/create-shipment`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Failed to create shipment')
      setAwb(data.awb)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (awb) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
        <svg className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <div>
          <p className="text-sm text-green-800 dark:text-green-300 font-medium">Shipment registered</p>
          <p className="text-xs text-green-700 dark:text-green-400 font-mono mt-0.5">AWB: {awb}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
      )}
      <button
        onClick={handleCreate}
        disabled={loading}
        className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Creating shipment…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Create Delhivery Shipment
          </>
        )}
      </button>
    </div>
  )
}
