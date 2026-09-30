'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ReconcileButton({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/ecom/${tenantId}/reconcile-settlements`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error || 'Failed')
        return
      }
      setMsg(`Settled ${data.settled} of ${data.scanned}`)
      router.refresh()
    } catch {
      setMsg('Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border-default p-4 bg-surface-elevated">
      <div className="text-xs text-foreground-muted uppercase tracking-wide">Settlements</div>
      <div className="text-sm font-bold text-foreground mt-1">Reconcile captured</div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Reconciling…' : 'Reconcile now'}
      </button>
      {msg && <div className="text-[11px] text-foreground-muted mt-1">{msg}</div>}
      <div className="text-[11px] text-foreground-muted mt-1">
        Settles captured rows whose transfer already processed at Razorpay.
      </div>
    </div>
  )
}
