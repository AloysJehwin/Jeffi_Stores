'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteCampaignButton({ id, title }: { id: string; title: string }) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setLoading(true)
    await fetch(`/api/admin/mailer/${id}`, { method: 'DELETE' })
    router.refresh()
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <button type="button" onClick={handleDelete} disabled={loading} className="text-red-600 hover:underline font-medium disabled:opacity-50">
          {loading ? 'Deleting…' : 'Confirm'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-foreground-muted hover:underline">Cancel</button>
      </span>
    )
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} className="text-red-500 hover:underline text-sm">
      Delete
    </button>
  )
}
