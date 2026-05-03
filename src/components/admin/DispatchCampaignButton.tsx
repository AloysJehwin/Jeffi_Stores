'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DispatchCampaignButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()

  async function handleDispatch() {
    setLoading(true)
    await fetch(`/api/admin/mailer/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatchNow: true }),
    })
    setDone(true)
    setLoading(false)
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleDispatch}
      disabled={loading || done}
      className="text-sm bg-accent-500 hover:bg-accent-600 text-white px-3 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
    >
      {loading ? 'Sending…' : done ? 'Sent!' : 'Dispatch'}
    </button>
  )
}
