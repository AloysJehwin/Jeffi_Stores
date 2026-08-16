'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Operator actions on a tenant: Provision (when provisioning) + test-tenant-only
// Disable/Enable instance. Rendered on the customer detail page.
export default function TenantActions({
  tenantId,
  slug,
  status,
  instanceState,
}: {
  tenantId: string
  slug: string
  status: string
  instanceState: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function call(path: string, body?: object, label?: string) {
    setBusy(label || path); setMsg(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      if (!res.ok) setMsg({ ok: false, text: data.error || 'Failed' })
      else { setMsg({ ok: true, text: 'Done' }); router.refresh() }
    } catch {
      setMsg({ ok: false, text: 'Network error' })
    } finally { setBusy(null) }
  }

  const isTest = slug === 'test'
  const stopped = instanceState === 'stopped'

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === 'provisioning' && (
        <button
          onClick={() => call(`/api/admin/ecom/customers/${tenantId}/provision`, undefined, 'provision')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {busy === 'provision' ? 'Provisioning…' : 'Provision infrastructure'}
        </button>
      )}

      {isTest && status === 'active' && (
        <button
          onClick={() => call(`/api/admin/ecom/customers/${tenantId}/disable-instance`, { action: stopped ? 'enable' : 'disable' }, 'toggle')}
          disabled={busy !== null}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg disabled:opacity-50 text-sm font-medium transition-colors text-white ${
            stopped ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'
          }`}
          title="Test tenant only — stops/starts the RDS instance to save cost"
        >
          {busy === 'toggle' ? '…' : stopped ? 'Enable instance' : 'Disable instance (save cost)'}
        </button>
      )}

      {isTest && stopped && (
        <span className="text-xs text-amber-600 dark:text-amber-400">Instance stopped — DB powered down (auto-restarts after 7 days)</span>
      )}

      {msg && (
        <span className={`text-sm ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</span>
      )}
    </div>
  )
}
