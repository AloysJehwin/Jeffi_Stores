import { NextRequest, NextResponse } from 'next/server'
import { activeProvisioningJobs, getProvisioningJob, controlPlanePool } from '@/lib/tenant-registry'
import { pendingK8sPlanTenants } from '@/lib/tenant-registry/provisioning'
import { advanceProvisioningJob, reconcileK8sPlan } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'
import { provisionTenantOwnerAdmin } from '@/lib/tenancy/tenant-admin-provision'
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
    // On transition to done, create the owner super_admin + cert in the now-real tenant DB.
    if (status === 'done') await fireOwnerAdmin(job.tenant_id)
  }

  // Plan changes waiting on a k8s node to join.
  for (const tenantId of await pendingK8sPlanTenants().catch(() => [])) {
    const r = await reconcileK8sPlan(tenantId, provider)
    results.push({ tenantId, step: 'k8s_plan', status: r.ok ? (r.error ?? 'applied') : `error: ${r.error}` })
  }

  // Owners' compute changes to running stores (and old databases due to be dropped).
  const { dueComputeChanges } = await import('@/lib/compute/store')
  const { reconcileCompute } = await import('@/lib/provisioning/compute-reconcile')
  for (const tenantId of await dueComputeChanges().catch(() => [])) {
    const r = await reconcileCompute(tenantId, provider).catch((e: any) => ({ ok: false, status: 'error', error: e?.message }))
    results.push({ tenantId, step: 'compute_change', status: r.ok ? r.status : `error: ${r.error}` })
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

async function fireOwnerAdmin(tenantId: string): Promise<void> {
  const row = await controlPlanePool()
    .query(
      `SELECT o.email, o.name, t.slug
     FROM owner_tenants ot
     JOIN owners o ON o.id = ot.owner_id
     JOIN tenants t ON t.id = ot.tenant_id
     WHERE ot.tenant_id = $1 LIMIT 1`,
      [tenantId]
    )
    .catch(() => null)
  const r = row?.rows[0]
  if (!r) return
  // Never silently: this is the step that creates the owner's admin account, issues their mTLS
  // certificate and emails it. A swallowed failure here leaves provisioning reporting "done"
  // while the owner cannot reach their admin panel at all — which is exactly what happened for
  // aloys-store. Provisioning itself stays successful (the store is live), but the failure is
  // recorded and alerted so someone knows to re-run it.
  const res = await provisionTenantOwnerAdmin({
    tenantId,
    tenantSlug: r.slug,
    ownerEmail: r.email,
    ownerName: r.name,
  }).catch((e: any) => ({ success: false, error: e?.message ?? String(e) }))

  if (!res.success) await reportOwnerAdminFailure(r.slug, res.error)

  // The tenant CA now exists; refresh the fleet's client-CA bundle + reload nginx so this
  // tenant's admin host advertises its CA (and prompts for the cert) without waiting for the
  // next deploy. Non-fatal — the store is live regardless.
  try {
    const { refreshTenantMtlsFleet } = await import('@/lib/tenancy/mtls-fleet')
    await refreshTenantMtlsFleet(r.slug)
  } catch (e: any) {
    const reason = e?.message ?? String(e)
    console.error(`[mtls-fleet] ${r.slug}: ${reason}`)
    try {
      const { alertProvisioningFailure } = await import('@/lib/provisioning/alerts')
      await alertProvisioningFailure(r.slug, 'mtls_fleet_refresh', reason)
    } catch {
      /* alerting must never mask the original failure */
    }
  }
}

/** Surface an owner-admin failure: logged, and alerted so it is not lost in the log. */
async function reportOwnerAdminFailure(slug: string, error?: string): Promise<void> {
  const msg = `[provisionTenantOwnerAdmin] ${slug}: ${error ?? 'unknown error'}`
  console.error(msg)
  try {
    const { alertProvisioningFailure } = await import('@/lib/provisioning/alerts')
    await alertProvisioningFailure(slug, 'owner_admin_cert', error ?? 'unknown error')
  } catch {
    /* alerting must never mask the original failure */
  }
}
