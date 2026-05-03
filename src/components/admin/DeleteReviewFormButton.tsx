'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteReviewFormButton({ id, title }: { id: string; title: string }) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/review-forms/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to delete form')
    }
    setLoading(false)
    setConfirming(false)
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button onClick={handleDelete} disabled={loading} className="text-xs text-red-600 hover:underline font-medium">
          {loading ? 'Deleting…' : 'Confirm'}
        </button>
        <button onClick={() => setConfirming(false)} className="text-xs text-foreground-muted hover:underline">Cancel</button>
      </span>
    )
  }

  return (
    <button onClick={() => setConfirming(true)} className="text-red-500 hover:underline text-sm">
      Delete
    </button>
  )
}
