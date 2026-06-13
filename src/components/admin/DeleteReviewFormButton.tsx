'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'

export default function DeleteReviewFormButton({ id, title }: { id: string; title: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Review Form',
      message: `Delete review form "${title}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return

    setLoading(true)
    const res = await fetch(`/api/admin/review-forms/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
    } else {
      const data = await res.json()
      showToast(data.error || 'Failed to delete form', 'error')
    }
    setLoading(false)
  }

  return (
    <button onClick={handleDelete} disabled={loading} className="text-red-500 hover:underline text-sm disabled:opacity-50">
      {loading ? 'Deleting…' : 'Delete'}
    </button>
  )
}
