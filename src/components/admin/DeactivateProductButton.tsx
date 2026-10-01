'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'

interface DeactivateProductButtonProps {
  productId: string
  productName: string
  isActive: boolean
}

export default function DeactivateProductButton({ productId, productName, isActive }: DeactivateProductButtonProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const { showToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()

  async function handleToggle() {
    const ok = await confirm({
      title: isActive ? 'Deactivate Product' : 'Activate Product',
      message: isActive
        ? `Deactivate "${productName}"? It will no longer be visible to customers.`
        : `Activate "${productName}"? It will become visible to customers.`,
      confirmLabel: isActive ? 'Deactivate' : 'Activate',
      cancelLabel: 'Cancel',
      variant: isActive ? 'danger' : 'default',
    })
    if (!ok) return

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
    } catch (error: any) {
      showToast(error.message || 'Failed to update product. Please try again.', 'error')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <RequireWrite scope="products:write">
      <button
        onClick={handleToggle}
        disabled={isUpdating}
        className={`disabled:opacity-50 ${isActive ? 'text-orange-600 hover:text-orange-900' : 'text-green-600 hover:text-green-900'}`}
      >
        {isUpdating ? (isActive ? 'Deactivating...' : 'Activating...') : isActive ? 'Deactivate' : 'Activate'}
      </button>
    </RequireWrite>
  )
}
