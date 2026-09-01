'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export default function DispatchCampaignButton({ id, scheduledAt }: { id: string; scheduledAt?: string | null }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()
  const canWrite = useCanWrite('campaigns:write')

  // Auto-dispatch if scheduled time has passed
  useEffect(() => {
    if (!canWrite) return
    if (!scheduledAt) return
    const due = new Date(scheduledAt) <= new Date()
    if (!due) return
    dispatch()
  }, [])

  async function dispatch() {
    if (loading || done) return
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

  if (!canWrite) return null

  return (
    <button
      type="button"
      onClick={dispatch}
      disabled={loading || done}
      className="text-sm bg-accent-500 hover:bg-accent-600 text-white px-3 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
    >
      {loading ? 'Sending…' : done ? 'Sent!' : 'Dispatch'}
    </button>
  )
}
