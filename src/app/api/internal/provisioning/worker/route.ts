import { NextRequest, NextResponse } from 'next/server'
import { activeProvisioningJobs, getProvisioningJob, controlPlanePool } from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'
import { provisionTenantOwnerAdmin } from '@/lib/tenant-admin-provision'
import { verifyCronRequest } from '@/lib/cron-auth'

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

  return NextResponse.json({ success: true, advanced: results.length, results })
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
    const { refreshTenantMtlsFleet } = await import('@/lib/mtls-fleet')
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
