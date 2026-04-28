'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface CustomerActionButtonProps {
  customerId: string
  customerName: string
  isActive: boolean
  isFlagged: boolean
}

export default function CustomerActionButton({
  customerId,
  customerName,
  isActive,
  isFlagged,
}: CustomerActionButtonProps) {
  const [confirm, setConfirm] = useState<'deactivate' | 'flag' | 'activate' | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()

  async function handleAction(action: 'deactivate' | 'flag' | 'activate') {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: flagReason || undefined }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Action failed')
      }

      const messages = {
        deactivate: `"${customerName}" has been deactivated.`,
        flag: `"${customerName}" has been flagged and deactivated.`,
        activate: `"${customerName}" has been reactivated.`,
      }

      showToast(messages[action], 'success')
      setConfirm(null)
      setFlagReason('')
      router.refresh()
    } catch (error: any) {
      showToast(error.message || 'Action failed. Please try again.', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  if (confirm === 'flag') {
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">Reason for flagging</label>
          <input
            type="text"
            value={flagReason}
            onChange={e => setFlagReason(e.target.value)}
            disabled={isLoading}
            placeholder="e.g. Multiple fraudulent orders"
            className="w-full px-3 py-2 border border-border-default rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => handleAction('flag')}
            disabled={isLoading}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Flagging...' : 'Confirm Flag'}
          </button>
          <button
            onClick={() => { setConfirm(null); setFlagReason('') }}
            disabled={isLoading}
            className="px-4 py-2 text-foreground-secondary hover:text-foreground text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (confirm === 'deactivate') {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleAction('deactivate')}
          disabled={isLoading}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Deactivating...' : 'Confirm Deactivate'}
        </button>
        <button
          onClick={() => setConfirm(null)}
          disabled={isLoading}
          className="px-4 py-2 text-foreground-secondary hover:text-foreground text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (confirm === 'activate') {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleAction('activate')}
          disabled={isLoading}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Reactivating...' : 'Confirm Reactivate'}
        </button>
        <button
          onClick={() => setConfirm(null)}
          disabled={isLoading}
          className="px-4 py-2 text-foreground-secondary hover:text-foreground text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-3">
      {(isActive || isFlagged) && (
        <button
          onClick={() => setConfirm('activate')}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Reactivate
        </button>
      )}
      {isActive && !isFlagged && (
        <button
          onClick={() => setConfirm('deactivate')}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Deactivate
        </button>
      )}
      {!isFlagged && (
        <button
          onClick={() => setConfirm('flag')}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Flag as Suspicious
        </button>
      )}
    </div>
  )
}
