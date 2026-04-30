'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface DeactivateProductButtonProps {
  productId: string
  productName: string
  isActive: boolean
}

export default function DeactivateProductButton({ productId, productName, isActive }: DeactivateProductButtonProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()

  async function handleToggle() {
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Failed to ${isActive ? 'deactivate' : 'activate'} product`)
      }

      showToast(`"${productName}" has been ${isActive ? 'deactivated' : 'activated'}.`, 'success')
      router.refresh()
      setShowConfirm(false)
    } catch (error: any) {
      showToast(error.message || 'Failed to update product. Please try again.', 'error')
    } finally {
      setIsUpdating(false)
    }
  }

  if (showConfirm) {
    return (
      <div className="inline-flex items-center gap-2">
        <button
          onClick={handleToggle}
          disabled={isUpdating}
          className={`font-semibold disabled:opacity-50 ${isActive ? 'text-orange-600 hover:text-orange-900' : 'text-green-600 hover:text-green-900'}`}
        >
          {isUpdating ? (isActive ? 'Deactivating...' : 'Activating...') : 'Confirm'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={isUpdating}
          className="text-foreground-secondary hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className={isActive ? 'text-orange-600 hover:text-orange-900' : 'text-green-600 hover:text-green-900'}
    >
      {isActive ? 'Deactivate' : 'Activate'}
    </button>
  )
}
