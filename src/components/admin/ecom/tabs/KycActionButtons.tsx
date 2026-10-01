'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function KycActionButtons({
  tenantId,
  mode = 'pending',
}: {
  tenantId: string
  // 'pending' = show Approve+Reject; 'retry' = show only Resend payment link
  mode?: 'pending' | 'retry'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function approve() {
    setBusy(true)
    setErr(null)
    setSuccess(null)
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/approve`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      setErr(data.error || 'Failed')
      setBusy(false)
      return
    }
    setSuccess('Approved — payment link sent to owner.')
    router.refresh()
    setBusy(false)
  }

  async function reject() {
    if (!note.trim()) {
      setErr('Please enter a reason for rejection.')
      return
    }
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    const data = await res.json()
    if (!res.ok) {
      setErr(data.error || 'Failed')
      setBusy(false)
      return
    }
    router.refresh()
  }

  // Re-runs subscription creation for already-approved tenants where Razorpay failed
  async function retrySubscription() {
    setBusy(true)
    setErr(null)
    setSuccess(null)
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/approve`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      setErr(data.error || 'Failed')
      setBusy(false)
      return
    }
    setSuccess('Payment link generated — owner can now pay.')
    router.refresh()
    setBusy(false)
  }

  if (mode === 'retry') {
    return (
      <div className="flex flex-col items-end gap-1">
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        {success && <p className="text-xs text-green-600 dark:text-green-400">{success}</p>}
        <button
          onClick={retrySubscription}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
        >
          {busy ? 'Generating…' : 'Resend payment link'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-400">{success}</p>}
      {showReject ? (
        <div className="flex flex-col gap-2 w-72">
          <textarea
            className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="Reason for rejection (shown to owner)…"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={reject}
              disabled={busy}
              className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {busy ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              onClick={() => setShowReject(false)}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setShowReject(true)}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
          >
            Reject
          </button>
          <button
            onClick={approve}
            disabled={busy}
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {busy ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}
    </div>
  )
}
