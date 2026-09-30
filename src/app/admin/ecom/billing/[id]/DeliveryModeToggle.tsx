'use client'

import { useState } from 'react'

export default function DeliveryModeToggle({
  tenantId,
  initial,
  hasOwnCreds,
}: {
  tenantId: string
  initial: boolean
  hasOwnCreds: boolean
}) {
  const [ownDelhivery, setOwnDelhivery] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Turning ON requires a connected token — the API enforces this too (409), but disabling the control
  // up front avoids a guaranteed-failing round trip and explains why.
  const canEnable = ownDelhivery || hasOwnCreds

  async function toggle() {
    const next = !ownDelhivery
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ecom/${tenantId}/delivery-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ own_delhivery: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to update delivery mode')
        return
      }
      setOwnDelhivery(next)
    } catch {
      setError('Failed to update delivery mode')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border-default p-4 bg-surface-elevated">
      <div className="text-xs text-foreground-muted uppercase tracking-wide">Delivery account</div>
      <div className="text-sm font-bold text-foreground mt-1">
        {ownDelhivery ? 'Own Delhivery (billed directly)' : 'Platform (wallet debit)'}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !canEnable}
        className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Saving…' : ownDelhivery ? 'Switch to platform' : 'Switch to own Delhivery'}
      </button>
      {!canEnable && <div className="text-[11px] text-foreground-muted mt-1">Connect a Delhivery token first.</div>}
      {error && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</div>}
    </div>
  )
}
