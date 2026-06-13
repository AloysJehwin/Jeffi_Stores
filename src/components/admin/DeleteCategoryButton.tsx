'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'

interface DeleteCategoryButtonProps {
  categoryId: string
  categoryName: string
  onDeleted?: () => void
}

export default function DeleteCategoryButton({ categoryId, categoryName, onDeleted }: DeleteCategoryButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const { showToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()

  async function handleDelete() {
    const ok = await confirm({
      title: 'Delete Category',
      message: `Delete "${categoryName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return

    setIsDeleting(true)

    try {
      const response = await fetch(`/api/categories/${categoryId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete category')
      }

      showToast(`"${categoryName}" deleted successfully.`, 'success')
      onDeleted?.()
      router.refresh()
    } catch (error: any) {
      showToast(error.message || 'Failed to delete category. Please try again.', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="text-red-600 hover:text-red-900 disabled:opacity-50"
    >
      {isDeleting ? 'Deleting...' : 'Delete'}
    </button>
  )
}
