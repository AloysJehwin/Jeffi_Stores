'use client'

import { useState } from 'react'

export default function AccountModeToggle({
  tenantId,
  initial,
  hasOwnCreds,
}: {
  tenantId: string
  initial: boolean
  hasOwnCreds: boolean
}) {
  const [ownRazorpay, setOwnRazorpay] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Turning ON requires connected creds — the API enforces this too (409), but disabling the control
  // up front avoids a guaranteed-failing round trip and explains why.
  const canEnable = ownRazorpay || hasOwnCreds

  async function toggle() {
    const next = !ownRazorpay
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ecom/${tenantId}/account-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ own_razorpay: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to update account mode')
        return
      }
      setOwnRazorpay(next)
    } catch {
      setError('Failed to update account mode')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border-default p-4 bg-surface-elevated">
      <div className="text-xs text-foreground-muted uppercase tracking-wide">Collection account</div>
      <div className="text-sm font-bold text-foreground mt-1">
        {ownRazorpay ? 'Own Razorpay (no platform charges)' : 'Platform (Route settlement)'}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !canEnable}
        className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Saving…' : ownRazorpay ? 'Switch to platform' : 'Switch to own Razorpay'}
      </button>
      {!canEnable && <div className="text-[11px] text-foreground-muted mt-1">Connect a Razorpay account first.</div>}
      {error && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</div>}
    </div>
  )
}
