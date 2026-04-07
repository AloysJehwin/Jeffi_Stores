'use client'

import { useState } from 'react'

export default function GenerateInvoiceButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/invoice`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to generate invoice')
        return
      }
      setInvoiceNumber(data.invoiceNumber)
    } catch {
      setError('Failed to generate invoice')
    } finally {
      setLoading(false)
    }
  }

  if (invoiceNumber) {
    return (
      <a
        href={`/api/orders/${orderId}/invoice`}
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 py-2 text-sm font-semibold rounded-full bg-accent-100 text-accent-800 hover:bg-accent-200 transition-colors inline-flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Invoice {invoiceNumber}
      </a>
    )
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="px-4 py-2 text-sm font-semibold rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {loading ? 'Generating...' : 'Generate Invoice'}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}
