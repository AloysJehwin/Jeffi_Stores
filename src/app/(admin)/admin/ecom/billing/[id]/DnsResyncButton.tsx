'use client'

import { useState } from 'react'

export default function DnsResyncButton({ tenantId }: { tenantId: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: string[]; removed: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resync() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/ecom/${tenantId}/dns/resync`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'DNS re-sync failed')
        return
      }
      setResult({ added: data.added ?? [], removed: data.removed ?? [] })
    } catch {
      setError('DNS re-sync failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border-default p-4 bg-surface-elevated">
      <div className="text-xs text-foreground-muted uppercase tracking-wide">Subdomain DNS</div>
      <div className="text-sm font-bold text-foreground mt-1">Re-sync to plan tier</div>
      <button
        type="button"
        onClick={resync}
        disabled={busy}
        className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Syncing…' : 'Re-sync DNS'}
      </button>
      <div className="text-[11px] text-foreground-muted mt-1">
        Adds any host the current plan includes (e.g. forms-) and removes hosts it no longer does.
      </div>
      {result && (
        <div className="text-[11px] text-foreground-secondary mt-1">
          {result.added.length === 0 && result.removed.length === 0
            ? 'Already in sync.'
            : `Added ${result.added.length}, removed ${result.removed.length}.`}
        </div>
      )}
      {error && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</div>}
    </div>
  )
}
