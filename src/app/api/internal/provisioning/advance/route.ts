import { NextRequest, NextResponse } from 'next/server'
import { getProvisioningJob, controlPlanePool } from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'
import { provisionTenantOwnerAdmin } from '@/lib/tenant-admin-provision'

export const dynamic = 'force-dynamic'

// Self-advancing provisioning driver (replaces the old cron worker). It advances ONE
// tenant's job by ONE step, then — if the job is still in flight — schedules a delayed
// self-POST back to this same route. The loop terminates when the job reaches done/failed.
// This is what lets provisioning walk the ~10-min RDS-create wait with no external cron:
// triggerProvisioning kicks the first tick, each tick reschedules the next.
//
// Auth: Bearer ${CRON_SECRET} (same as the other internal/cron routes). Only reachable
// server-to-server; the owner-facing trigger never hits this directly.

const RETICK_DELAY_MS = 15_000 // gap between ticks while a job is still pending

function reschedule(tenantId: string, delayMs: number): void {
  const cronSecret = process.env.CRON_SECRET
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!cronSecret || !appUrl) return
  setTimeout(() => {
    fetch(`${appUrl}/api/internal/provisioning/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({ tenantId }),
    }).catch(() => {})
  }, delayMs)
}

/** Create the owner super_admin + mTLS cert in the freshly provisioned tenant DB. Idempotent;
 * safe to call once the job is done (tenant RDS now exists). No-op if already created. */
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

  if (!res.success) {
    console.error(`[provisionTenantOwnerAdmin] ${r.slug}: ${res.error ?? 'unknown error'}`)
    try {
      const { alertProvisioningFailure } = await import('@/lib/provisioning/alerts')
      await alertProvisioningFailure(r.slug, 'owner_admin_cert', res.error ?? 'unknown error')
    } catch {
      /* alerting must never mask the original failure */
    }
  }

  // The tenant CA now exists; refresh the fleet's client-CA bundle + reload nginx so this
  // tenant's admin host advertises its CA (and prompts for the cert) without waiting for the
  // next deploy. Non-fatal: the store is live regardless, so a fleet-reload failure is logged
  // and alerted, never allowed to fail provisioning.
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

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const tenantId: string | undefined = body?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const job = await getProvisioningJob(tenantId)
  if (!job || job.status === 'done' || job.status === 'failed') {
    // Nothing in flight — stop the loop. If it just finished, ensure the owner admin exists.
    if (job?.status === 'done') await fireOwnerAdmin(tenantId)
    return NextResponse.json({ done: true, status: job?.status ?? 'none' })
  }

  // Respect the engine's backoff timer: if this tick fired early, reschedule for when due.
  if (job.next_attempt_at) {
    const dueMs = new Date(job.next_attempt_at).getTime() - Date.now()
    if (dueMs > 0) {
      reschedule(tenantId, Math.min(dueMs, RETICK_DELAY_MS * 4))
      return NextResponse.json({ waiting: true, dueInMs: dueMs })
    }
  }

  // Per-tenant lock so a double kick (owner route + webhook) never interleaves ticks.
  let locked = false
  try {
    const { default: redis } = await import('@/lib/redis')
    locked = (await redis.set(`prov:lock:${tenantId}`, '1', 'PX', RETICK_DELAY_MS * 2, 'NX')) === 'OK'
  } catch {
    locked = true // redis unavailable → proceed rather than starve
  }
  if (!locked) return NextResponse.json({ skipped: 'locked' })

  const provider = getProvisioningProvider()
  const status = await advanceProvisioningJob(job, provider).catch((e: any) => `error: ${e?.message}`)

  if (status === 'pending') {
    reschedule(tenantId, RETICK_DELAY_MS)
  } else if (status === 'done') {
    await fireOwnerAdmin(tenantId)
  }
  // 'failed' or an error string → stop (engine already ran rollback).

  return NextResponse.json({ advanced: true, step: job.step, status })
}
