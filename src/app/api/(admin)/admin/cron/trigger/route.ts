import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { CRON_JOBS, isCronJobId } from '@/lib/shared/cron-jobs'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { getTenantPlan } from '@/lib/auth/plan-gate'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
const SELF_BASE = process.env.CRON_SELF_BASE || `http://127.0.0.1:${process.env.PORT || '3000'}`

// Manually run ONE cron job for the CURRENT store (the tenant whose admin panel this is, or the
// flagship). Mirrors deploy/k8s-cron.mjs for a single target: call the job route with this store's
// Host + the cron bearer so it hits the right DB, then record the run into that store's site_settings
// so the Cron Jobs tab shows it. Does NOT fan out across the fleet — a tenant admin only runs its own.
export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // audit:read is what every plan grants (and what the Cron Jobs tab is gated on); a manual run of
    // the store's own job is a read-level operation, not a platform-config change.
    if (!hasScope(admin.role, admin.scopes, 'audit:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { jobId } = await request.json()
    if (!isCronJobId(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
    const job = CRON_JOBS.find(j => j.id === jobId)!

    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })

    // Resolve the current store. A tenant triggers only its OWN store; the flagship uses the root host.
    const tenant = await resolveTenant().catch(() => null)
    const host = tenant?.slug ? `${tenant.slug}.${ROOT_DOMAIN}` : ROOT_DOMAIN

    // Platform-only jobs (tenantScope === null) are infra — a tenant may not run them.
    if (job.tenantScope === null && tenant) {
      return NextResponse.json({ error: 'This job runs at the platform level only' }, { status: 403 })
    }
    // Plan gate: a tenant may only trigger jobs its plan grants.
    if (job.tenantScope !== null && tenant) {
      const inPlan = await getTenantPlan(tenant.tenantId)
        .then(p => p.scopes.has(job.tenantScope!))
        .catch(() => false)
      if (!inPlan) return NextResponse.json({ error: 'Not included in your plan' }, { status: 403 })
    }

    const headers = { Host: host, Authorization: `Bearer ${cronSecret}` }
    let ok = false
    let errorMsg: string | undefined
    let detail: unknown
    try {
      const res = await fetch(`${SELF_BASE}${job.path}`, {
        method: job.method,
        headers,
        signal: AbortSignal.timeout(290_000),
      })
      ok = res.ok
      if (!ok) errorMsg = `HTTP ${res.status}`
      detail = await res.json().catch(() => undefined)
    } catch (e: any) {
      ok = false
      errorMsg = e?.message || 'fetch failed'
    }

    // Record the run into THIS store's site_settings (same Host → same DB) so the tab reflects it.
    await fetch(`${SELF_BASE}/api/internal/cron-record`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, ok, errorMsg, detail }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {})

    return NextResponse.json({ ok, error: ok ? undefined : errorMsg })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
