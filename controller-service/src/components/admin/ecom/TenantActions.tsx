'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play, Power, PowerOff, RotateCcw, Server } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'
import DeprovisionDialog from './DeprovisionDialog'

// Operator actions on a tenant: Provision / Retry / Deprovision + test-tenant-only
// Disable/Enable instance. Rendered in the tenant detail header.
export default function TenantActions({
  tenantId,
  slug,
  status,
  instanceState,
  jobStatus,
  jobStep,
  rolledBack,
  retentionDays = 30,
}: {
  tenantId: string
  slug: string
  status: string
  instanceState: string
  /** Latest provisioning job, so a run in flight hides Provision and a failure offers Retry. */
  jobStatus?: string | null
  jobStep?: string | null
  rolledBack?: boolean
  /** Days a deprovisioned store's kept data stays (archiveRetentionDays). */
  retentionDays?: number
}) {
  const router = useRouter()
  const toast = useActionToast()
  const [deprovisionOpen, setDeprovisionOpen] = useState(false)

  const call = (path: string, body?: object) => async () => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res) return toast.error('Network error')
    if (!res.ok) return toast.error(data?.error || 'Failed')
    toast.success('Done')
    router.refresh()
  }

  const isTest = slug === 'test'
  const stopped = instanceState === 'stopped'
  const inFlight = jobStatus === 'pending' || jobStatus === 'running'
  const failed = jobStatus === 'failed'
  // Rollback deleted what the run had built, so resuming mid-way is not available, only a fresh provision.
  const canResume = failed && !rolledBack
  const base = `/api/admin/ecom/customers/${tenantId}`

  return (
    <>
      {inFlight && (
        <span className="inline-flex max-w-full items-center gap-2 px-3 h-control rounded-lg border border-border-default text-sm text-foreground-secondary min-w-0">
          <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
          <span className="truncate">Provisioning{jobStep ? `: ${jobStep}` : ''}</span>
        </span>
      )}

      {canResume && (
        <ActionButton variant="primary" action={{ label: `Retry from ${jobStep ?? 'last step'}`, icon: RotateCcw, onClick: call(`${base}/retry`) }} />
      )}

      {(status === 'provisioning' || (status === 'suspended' && rolledBack)) && !inFlight && (
        <ActionButton variant="primary" action={{ label: failed ? 'Start fresh provision' : 'Provision infrastructure', icon: Play, onClick: call(`${base}/provision`) }} />
      )}

      {isTest && status === 'active' && (
        <ActionButton
          action={{
            label: stopped ? 'Enable instance' : 'Disable instance',
            icon: stopped ? Power : PowerOff,
            onClick: call(`${base}/disable-instance`, { action: stopped ? 'enable' : 'disable' }),
            confirm: stopped ? undefined : 'Stop the test tenant’s RDS instance to save cost? AWS restarts it after 7 days.',
          }}
        />
      )}

      {status === 'active' && (
        <>
          <ActionButton action={{ label: 'Deprovision', icon: Server, danger: true, onClick: () => setDeprovisionOpen(true) }} />
          <DeprovisionDialog
            open={deprovisionOpen}
            slug={slug}
            retentionDays={retentionDays}
            onClose={() => setDeprovisionOpen(false)}
            onConfirm={async keep => {
              await call(`${base}/deprovision`, { confirm: true, keep })()
              setDeprovisionOpen(false)
            }}
          />
        </>
      )}

      {isTest && stopped && <span className="w-full text-xs text-amber-600 dark:text-amber-400">Instance stopped: DB powered down (auto-restarts after 7 days)</span>}
    </>
  )
}
