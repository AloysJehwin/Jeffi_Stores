import { NextRequest, NextResponse } from 'next/server'
import { getProvisioningJob } from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@controller/lib/provisioning/steps'
import { getProvisioningProvider } from '@controller/lib/provisioning'
import { fireOwnerAdmin } from '@controller/lib/tenancy/tenant-admin-provision'
import { issuesOwnerCertificate } from '@controller/lib/provisioning/pipeline'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

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

export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const tenantId: string | undefined = body?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const job = await getProvisioningJob(tenantId)
  if (!job || job.status === 'done' || job.status === 'failed') {
    // Nothing in flight — stop the loop. If it just finished, ensure the owner admin exists (unless its pipeline issued it).
    if (job?.status === 'done' && !issuesOwnerCertificate(job.pipeline)) await fireOwnerAdmin(tenantId)
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
    const { default: redis } = await import('@/lib/shared/redis')
    locked = (await redis.set(`prov:lock:${tenantId}`, '1', 'PX', RETICK_DELAY_MS * 2, 'NX')) === 'OK'
  } catch {
    locked = true // redis unavailable → proceed rather than starve
  }
  if (!locked) return NextResponse.json({ skipped: 'locked' })

  const provider = getProvisioningProvider()
  const status = await advanceProvisioningJob(job, provider).catch((e: any) => `error: ${e?.message}`)

  if (status === 'pending') {
    reschedule(tenantId, RETICK_DELAY_MS)
  } else if (status === 'done' && !issuesOwnerCertificate(job.pipeline)) {
    await fireOwnerAdmin(tenantId)
  }
  // 'failed' or an error string → stop (engine already ran rollback).

  return NextResponse.json({ advanced: true, step: job.step, status })
}
