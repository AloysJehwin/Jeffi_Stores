'use client'
import { useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface Props {
  orderId: string
  remittedAt: string | null
  codAmount: number
}

/**
 * COD remittance tracker — shown on delivered COD orders whose cash Delhivery
 * has collected but not yet remitted to the seller. Marks/clears cod_remitted_at
 * via PATCH /api/admin/orders/[id].
 */
export default function CodRemittanceButton({ orderId, remittedAt, codAmount }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canWrite = useCanWrite('financial:write')

  async function setRemitted(remitted: boolean) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cod_remitted: remitted }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to update')
      }
      window.location.reload()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const inr = `₹${codAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

  if (remittedAt) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-800 dark:text-green-300">
            COD {inr} remitted on{' '}
            {new Date(remittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setRemitted(false)}
            disabled={saving}
            className="text-xs text-foreground-muted hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {saving ? '…' : 'Undo'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <svg
          className="w-4 h-4 text-orange-600 dark:text-orange-400 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm text-orange-800 dark:text-orange-300 font-medium">COD {inr} not yet remitted</p>
          {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
        </div>
      </div>
      {canWrite && (
        <button
          onClick={() => setRemitted(true)}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {saving ? 'Saving…' : 'Mark as remitted'}
        </button>
      )}
    </div>
  )
}
