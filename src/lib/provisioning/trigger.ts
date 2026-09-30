import { getProvisioningProvider } from './index'
import { advanceProvisioningJob, deprovisionTenant, reprovisionDns } from './steps'
import {
  getTenant,
  getProvisioningJob,
  enqueueProvisioning,
  updateProvisioningJob,
  controlPlanePool,
  getDraft,
} from '../tenant-registry'
import { findLatestBackup } from '../tenant-backup-store'
import { SEED_PROFILES } from './seed-catalog'

/** The tenant's onboarding category doubles as its starter-catalogue profile. */
async function resolveSeedProfile(tenantId: string): Promise<string | undefined> {
  try {
    const r = await controlPlanePool().query('SELECT product_categories FROM tenant_kyc WHERE tenant_id = $1', [
      tenantId,
    ])
    const raw = (r.rows[0]?.product_categories ?? '') as string
    const first = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)[0]
    if (!first) return undefined
    return SEED_PROFILES.includes(first) ? first : 'Other'
  } catch {
    return undefined // seeding is a nicety; never block provisioning on it
  }
}

// Single entry point for every provisioning/deprovisioning trigger. All four flows —
// first provision (payment webhook + onboard success), plan upgrade/downgrade
// (reprovision), missed-payment deprovision, owner-requested cancel — funnel through
// triggerProvisioning so there is ONE code path. The engine itself (steps.ts) is unchanged;
// this only decides which engine entry to call, seeds the job payload, and (for AWS) kicks
// the self-advancing HTTP loop that walks the job to completion without a cron.

export type ProvisioningAction = 'provision' | 'reprovision' | 'deprovision'

export type ProvisioningReason = 'first_payment' | 'plan_change' | 'missed_payment' | 'owner_cancel' | 'operator'

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
  const ownerRow = await controlPlanePool()
    .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId])
    .catch(() => null)
  const ownerId = ownerRow?.rows[0]?.owner_id
  if (!ownerId) return undefined
  const draft = await getDraft(ownerId).catch(() => null)
  if (!draft?.data?.restorePreviousData) return undefined
  const backup = await findLatestBackup({ ownerId, slug }).catch(() => null)
  return backup?.key
}

const usingStub = () => process.env.PROVISIONING_PROVIDER !== 'aws'

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
  // Seed optional payload fields the engine reads out of created_resources. A restored
  // store keeps its own data, so seeding is skipped there.
  const seedProfile = t.restoreFromKey ? undefined : (t.seedProfile ?? (await resolveSeedProfile(t.tenantId)))
  if (seedProfile) {
    await updateProvisioningJob(job.id, {
      created_resources: { ...(job.created_resources || {}), seedProfile },
    })
  }

  if (usingStub()) {
    const status = await driveStubToCompletion(t.tenantId)
    return { ok: status === 'done', jobStatus: status }
  }

  // AWS: drive the job inline as far as it will go WITHOUT blocking on the long RDS wait.
  // A background setTimeout self-fetch is unreliable here — in the Next server/serverless model
  // the request scope is torn down after the response, so a post-response timer may never fire
  // (observed: the loop never started). Instead we AWAIT each step until the job parks on a
  // pending poll (wait_db_available / verify_serving) or reaches a terminal state. The recurring
  // provisioning worker (instrumentation.ts → /api/internal/provisioning/worker) then advances
  // it across the ~10-min RDS wait. Bounded so a fast run can complete inline, but a long poll
  // hands off to the worker instead of blocking the request.
  const MAX_INLINE_STEPS = 6
  let status = job.status
  let prevStep = job.step
  for (let i = 0; i < MAX_INLINE_STEPS; i++) {
    const fresh = await getProvisioningJob(t.tenantId)
    if (!fresh || fresh.status === 'done' || fresh.status === 'failed') {
      status = fresh?.status ?? status
      break
    }
    status = await advanceProvisioningJob(fresh, provider)
    const after = await getProvisioningJob(t.tenantId)
    // Parked on a poll step (same step, still pending) → hand off to the recurring worker.
    if (after && after.step === prevStep && after.status === 'pending') break
    prevStep = after?.step ?? prevStep
    if (status === 'done' || status === 'failed') break
  }
  return { ok: status !== 'failed', jobStatus: status }
}
