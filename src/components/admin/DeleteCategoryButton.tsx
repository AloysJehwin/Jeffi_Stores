'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface DeleteCategoryButtonProps {
  categoryId: string
  categoryName: string
}

export default function DeleteCategoryButton({ categoryId, categoryName }: DeleteCategoryButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()

  async function handleDelete() {
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/categories/${categoryId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete category')
      }

      router.refresh()
      setShowConfirm(false)
    } catch (error: any) {
      showToast(error.message || 'Failed to delete category. Please try again.', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  if (showConfirm) {
    return (
      <div className="inline-flex items-center gap-2">
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-red-600 hover:text-red-900 font-semibold disabled:opacity-50"
        >
          {isDeleting ? 'Deleting...' : 'Confirm'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={isDeleting}
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
      className="text-red-600 hover:text-red-900"
    >
      Delete
    </button>
  )
}
