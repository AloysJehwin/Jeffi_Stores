'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface DeactivateProductButtonProps {
  productId: string
  productName: string
}

export default function DeactivateProductButton({ productId, productName }: DeactivateProductButtonProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()

  async function handleDeactivate() {
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to deactivate product')
      }

      showToast(`"${productName}" has been deactivated.`, 'success')
      router.refresh()
      setShowConfirm(false)
    } catch (error: any) {
      showToast(error.message || 'Failed to deactivate product. Please try again.', 'error')
    } finally {
      setIsUpdating(false)
    }
  }

  if (showConfirm) {
    return (
      <div className="inline-flex items-center gap-2">
        <button
          onClick={handleDeactivate}
          disabled={isUpdating}
          className="text-orange-600 hover:text-orange-900 font-semibold disabled:opacity-50"
        >
          {isUpdating ? 'Deactivating...' : 'Confirm'}
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
      className="text-orange-600 hover:text-orange-900"
    >
      Deactivate
    </button>
  )
}
