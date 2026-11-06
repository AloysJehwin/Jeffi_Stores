import { NextRequest, NextResponse } from 'next/server'
import { activeProvisioningJobs, getProvisioningJob, controlPlanePool } from '@/lib/tenant-registry'
import { pendingK8sPlanTenants } from '@/lib/tenant-registry/provisioning'
import { advanceProvisioningJob, reconcileK8sPlan } from '@controller/lib/provisioning/steps'
import { getProvisioningProvider } from '@controller/lib/provisioning'
import { fireOwnerAdmin } from '@controller/lib/tenancy/tenant-admin-provision'
import { issuesOwnerCertificate } from '@controller/lib/provisioning/pipeline'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Recurring provisioning worker. Advances every active job by ONE step per tick. Driven by the
// in-app scheduler (instrumentation.ts) on a short interval — this replaces the unreliable
// per-request setTimeout self-fetch: in the Next server model a post-response timer may never
// fire, so a job that parks on the ~10-min RDS wait needs an out-of-band driver to keep moving
// it. Idempotent per step. Auth: Bearer ${CRON_SECRET}.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // One tick at a time: the CronJob client gives up at 50s but the server keeps working, so without
  // this a slow tick (schema load, rollback's param-group wait) overlaps the next and a step — e.g. a
  // node launch — can run twice.
  const lock = await controlPlanePool().connect()
  try {
    const got = await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [WORKER_LOCK_KEY])
    if (!got.rows[0]?.ok) return NextResponse.json({ success: true, skipped: 'previous tick still running' })
    try {
      return NextResponse.json(await tick())
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK_KEY]).catch(() => {})
    }
  } finally {
    lock.release()
  }
}

const WORKER_LOCK_KEY = 0x6a656666 // arbitrary, app-wide

async function tick() {
  const provider = getProvisioningProvider()
  const jobs = await activeProvisioningJobs()
  const results: Array<{ tenantId: string; step: string; status: string }> = []

  for (const job of jobs) {
    const fresh = await getProvisioningJob(job.tenant_id)
    if (!fresh || fresh.status === 'done' || fresh.status === 'failed') continue
    const status = await advanceProvisioningJob(fresh, provider).catch((e: any) => `error: ${e?.message}`)
    results.push({ tenantId: job.tenant_id, step: fresh.step, status })
    // On transition to done, create the owner super_admin + cert, unless the pipeline already did (issue_owner_certificate).
    if (status === 'done' && !issuesOwnerCertificate(fresh.pipeline)) await fireOwnerAdmin(job.tenant_id)
  }

  // Plan changes waiting on a k8s node to join.
  for (const tenantId of await pendingK8sPlanTenants().catch(() => [])) {
    const r = await reconcileK8sPlan(tenantId, provider)
    results.push({ tenantId, step: 'k8s_plan', status: r.ok ? (r.error ?? 'applied') : `error: ${r.error}` })
  }

  // Owners' compute changes to running stores (and old databases due to be dropped).
  const { dueComputeChanges } = await import('@controller/lib/compute/store')
  const { reconcileCompute } = await import('@controller/lib/provisioning/compute-reconcile')
  for (const tenantId of await dueComputeChanges().catch(() => [])) {
    const r = await reconcileCompute(tenantId, provider).catch((e: any) => ({ ok: false, status: 'error', error: e?.message }))
    results.push({ tenantId, step: 'compute_change', status: r.ok ? r.status : `error: ${r.error}` })
  }

  // Stores part-way off the old all-in-one app (the release starts each move; see switch-layout).
  const { dueLayoutSwitches } = await import('@controller/lib/compute/store')
  const { reconcileLayout } = await import('@controller/lib/provisioning/layout-switch')
  for (const tenantId of await dueLayoutSwitches().catch(() => [])) {
    const r = await reconcileLayout(tenantId).catch((e: any) => ({ ok: false, status: 'error', detail: e?.message }))
    results.push({ tenantId, step: 'layout_switch', status: r.ok ? `${r.status}${r.detail ? `: ${r.detail}` : ''}` : `error: ${r.detail}` })
  }

  // New stores whose plan is paid and whose servers' prepayment has since arrived (a top-up the webhook credited).
  const { startStoreIfReady } = await import('@controller/lib/provisioning/start-store')
  const waiting = await controlPlanePool()
    .query<{ id: string }>(
      `SELECT id FROM tenants WHERE subscription_status = 'active'
          AND (store_request = 'awaiting_payment' OR (store_request IS NULL AND status = 'awaiting_payment'))`
    )
    .catch(() => ({ rows: [] as { id: string }[] }))
  for (const { id } of waiting.rows) {
    if (await startStoreIfReady(id).catch(() => false)) results.push({ tenantId: id, step: 'start_store', status: 'started' })
  }

  // Pool servers left empty (stores moved to their own servers or left) are terminated after an hour.
  const k8s = await import('@/lib/k8s/tenant-compute')
  if (k8s.k8sComputeEnabled()) {
    const reclaimed = await k8s.reclaimEmptyPoolNodes(id => provider.deleteAppInstance(id)).catch((e: any) => {
      console.error('[provisioning] pool reclaim failed:', e?.message)
      return []
    })
    for (const id of reclaimed) results.push({ tenantId: '-', step: 'pool_reclaim', status: `terminated ${id}` })
  }

  return { success: true, advanced: results.length, results }
}
