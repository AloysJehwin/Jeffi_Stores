'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

export default function DispatchCampaignButton({ id, scheduledAt }: { id: string; scheduledAt?: string | null }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()
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
    const res = await fetch(`/api/admin/mailer/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatchNow: true }),
    })
    if (res.status === 423) {
      // Another admin holds this draft; only they can send it.
      showToast((await res.json().catch(() => ({}))).error || 'Someone else is editing this message', 'error')
      setLoading(false)
      return
    }
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
      className="text-sm bg-accent-500 hover:bg-accent-600 text-white px-3 h-control-sm rounded-lg font-medium transition-colors disabled:opacity-50"
    >
      {loading ? 'Sending…' : done ? 'Sent!' : 'Dispatch'}
    </button>
  )
}
