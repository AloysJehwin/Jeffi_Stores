'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Operator actions on a tenant: Provision / Retry / Deprovision + test-tenant-only
// Disable/Enable instance. Rendered on the tenant object pages.
export default function TenantActions({
  tenantId,
  slug,
  status,
  instanceState,
  jobStatus,
  jobStep,
  rolledBack,
}: {
  tenantId: string
  slug: string
  status: string
  instanceState: string
  /** Latest provisioning job, so a run in flight hides Provision and a failure offers Retry. */
  jobStatus?: string | null
  jobStep?: string | null
  rolledBack?: boolean
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

  const inFlight = jobStatus === 'pending' || jobStatus === 'running'
  const failed = jobStatus === 'failed'
  // Rollback deleted what the run had built, so resuming mid-way is not available — only a
  // fresh provision is correct.
  const canResume = failed && !rolledBack

  return (
    <div className="flex flex-wrap items-center gap-3">
      {inFlight && (
        <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border-default text-sm text-foreground-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Provisioning{jobStep ? ` — ${jobStep}` : ''}
        </span>
      )}

      {canResume && (
        <button
          onClick={() => call(`/api/admin/ecom/customers/${tenantId}/retry`, undefined, 'retry')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          title={`Resume from "${jobStep}" — keeps everything the run already created`}
        >
          {busy === 'retry' ? 'Resuming…' : `Retry from ${jobStep ?? 'last step'}`}
        </button>
      )}

      {status === 'provisioning' && !inFlight && (
        <button
          onClick={() => call(`/api/admin/ecom/customers/${tenantId}/provision`, undefined, 'provision')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          title={failed ? 'Start a fresh provisioning run from the first step' : undefined}
        >
          {busy === 'provision'
            ? 'Provisioning…'
            : failed ? 'Start fresh provision' : 'Provision infrastructure'}
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

      {status === 'active' && (
        <button
          onClick={() => {
            if (!confirm(`Deprovision "${slug}"? The store goes offline immediately, its database is backed up to S3, then the RDS instance and bucket are DELETED. This is destructive.`)) return
            call(`/api/admin/ecom/customers/${tenantId}/deprovision`, { confirm: true }, 'deprovision')
          }}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          title="Take store down, back up its DB to S3, then delete RDS + bucket"
        >
          {busy === 'deprovision' ? 'Deprovisioning…' : 'Deprovision & back up'}
        </button>
      )}

      {msg && (
        <span className={`text-sm ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</span>
      )}
    </div>
  )
}
