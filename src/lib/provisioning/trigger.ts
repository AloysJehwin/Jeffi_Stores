import { getProvisioningProvider } from './index'
import {
  advanceProvisioningJob,
  deprovisionTenant,
  reprovisionDns,
} from './steps'
import {
  getTenant,
  getProvisioningJob,
  enqueueProvisioning,
  updateProvisioningJob,
  controlPlanePool,
  getDraft,
} from '../tenant-registry'
import { findLatestBackup } from '../tenant-backup-store'

// Single entry point for every provisioning/deprovisioning trigger. All four flows —
// first provision (payment webhook + onboard success), plan upgrade/downgrade
// (reprovision), missed-payment deprovision, owner-requested cancel — funnel through
// triggerProvisioning so there is ONE code path. The engine itself (steps.ts) is unchanged;
// this only decides which engine entry to call, seeds the job payload, and (for AWS) kicks
// the self-advancing HTTP loop that walks the job to completion without a cron.

export type ProvisioningAction = 'provision' | 'reprovision' | 'deprovision'

export type ProvisioningReason =
  | 'first_payment'
  | 'plan_change'
  | 'missed_payment'
  | 'owner_cancel'
  | 'operator'

/** Full self-contained payload a caller hands to the engine. */
export interface ProvisioningTrigger {
  action: ProvisioningAction
  tenantId: string
  slug: string
  plan: string | null
  ownerId: string | null
  restoreFromKey?: string
  seedProfile?: string
  hostnames?: string[]
  reason?: ProvisioningReason
}

export interface TriggerResult {
  ok: boolean
  jobStatus?: string
  added?: string[]
  removed?: string[]
  error?: string
}

/**
 * Resolve a restore-from-backup key IF the owner opted into "restore my previous store
 * data" during onboarding AND a backup actually exists (by owner id or the new slug).
 * Shared by the owner route, the payment webhook and the admin operator route.
 */
export async function resolveRestoreKey(tenantId: string, slug: string): Promise<string | undefined> {
  const ownerRow = await controlPlanePool().query(
    `SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId],
  ).catch(() => null)
  const ownerId = ownerRow?.rows[0]?.owner_id
  if (!ownerId) return undefined
  const draft = await getDraft(ownerId).catch(() => null)
  if (!draft?.data?.restorePreviousData) return undefined
  const backup = await findLatestBackup({ ownerId, slug }).catch(() => null)
  return backup?.key
}

const usingStub = () => process.env.PROVISIONING_PROVIDER !== 'aws'

/**
 * Kick the self-advancing loop for a tenant's provisioning job (AWS only). Fire-and-forget:
 * schedules one POST to the internal advance route, which advances one step and reschedules
 * itself until the job is done/failed. Mirrors the self-call pattern in instrumentation.ts
 * (fetch APP_URL with Bearer CRON_SECRET). No-op under the stub (jobs run inline) or when
 * the self-call prerequisites are missing.
 */
export function kickAdvance(tenantId: string): void {
  if (usingStub()) return
  const cronSecret = process.env.CRON_SECRET
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!cronSecret || !appUrl) return
  setTimeout(() => {
    fetch(`${appUrl}/api/internal/provisioning/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({ tenantId }),
    }).catch(() => {})
  }, 0)
}

/** Drive a stub job to completion in-request (local dev + tests are synchronous). */
async function driveStubToCompletion(tenantId: string): Promise<string | undefined> {
  const provider = getProvisioningProvider()
  for (let i = 0; i < 20; i++) {
    const job = await getProvisioningJob(tenantId)
    if (!job || job.status === 'done' || job.status === 'failed') return job?.status
    await advanceProvisioningJob(job, provider)
  }
  return (await getProvisioningJob(tenantId))?.status
}

/**
 * Trigger a provisioning action for a tenant.
 *  - provision:   enqueue (idempotent) + seed payload, then advance (stub inline / AWS kick)
 *  - reprovision: DNS-only re-apply for a plan change (never recreates infra)
 *  - deprovision: backup + teardown via deprovisionTenant
 */
export async function triggerProvisioning(t: ProvisioningTrigger): Promise<TriggerResult> {
  const provider = getProvisioningProvider()

  if (t.action === 'reprovision') {
    const r = await reprovisionDns(t.tenantId, provider)
    return { ok: r.ok, added: r.added, removed: r.removed, error: r.error }
  }

  if (t.action === 'deprovision') {
    const r = await deprovisionTenant(t.tenantId, provider, { ownerId: t.ownerId })
    return { ok: r.ok, error: r.error }
  }

  // action === 'provision'
  const job = await enqueueProvisioning(t.tenantId, t.restoreFromKey ? { restoreFromKey: t.restoreFromKey } : undefined)
  // Seed optional payload fields the engine reads out of created_resources.
  if (t.seedProfile) {
    await updateProvisioningJob(job.id, {
      created_resources: { ...(job.created_resources || {}), seedProfile: t.seedProfile },
    })
  }

  if (usingStub()) {
    const status = await driveStubToCompletion(t.tenantId)
    return { ok: status === 'done', jobStatus: status }
  }

  // AWS: enqueue-only + self-advancing loop (RDS create takes ~10 min).
  kickAdvance(t.tenantId)
  return { ok: true, jobStatus: job.status }
}
