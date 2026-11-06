import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { CRON_JOBS, isCronJobId } from '@/lib/shared/cron-jobs'
import { internalRequest } from '@/lib/shared/internal-http'
import { cronFlagshipBase, cronSelfBase, flagshipCronHost, storeCronHost, storeCronTarget } from '@controller/lib/cron/targets'

export const dynamic = 'force-dynamic'

// Per-tenant cron fan-out. A single k8s CronJob calls this once per job; for a tenant-scoped job it
// runs the job route for the flagship AND every active tenant whose PLAN grants the job's
// tenantScope. Platform-only jobs (tenantScope === null) just run once against the flagship.
//
// Each per-tenant call hits the job's own route with that tenant's Host header, so the route's
// existing Host→tenant resolution routes getPool to the tenant DB and records run status in that
// tenant's own site_settings. Auth: bearer CRON_SECRET (verifyCronRequest).
//
// Store jobs run on the store's admin service (a store still on the old all-in-one app: that app, for the
// routes it serves, else reported skipped), platform jobs on this app. Bases: lib/cron/targets.ts.

const CONCURRENCY = Math.max(1, Number(process.env.CRON_FANOUT_CONCURRENCY || '5'))
const PER_CALL_TIMEOUT_MS = Number(process.env.CRON_FANOUT_TIMEOUT_MS || '280000')

type Target = { host: string; slug: string; base: string }
type TargetResult = { host: string; slug: string; status: 'ok' | 'failed' | 'skipped'; detail?: string }

async function runOne(job: (typeof CRON_JOBS)[number], t: Target, secret: string): Promise<TargetResult> {
  try {
    const res = await internalRequest(`${t.base}${job.path}`, {
      method: job.method,
      host: t.host,
      headers: { Authorization: `Bearer ${secret}` },
      timeoutMs: PER_CALL_TIMEOUT_MS,
    })
    if (!res.ok) return { host: t.host, slug: t.slug, status: 'failed', detail: `HTTP ${res.status}` }
    return { host: t.host, slug: t.slug, status: 'ok' }
  } catch (e: any) {
    return { host: t.host, slug: t.slug, status: 'failed', detail: e?.message || 'request failed' }
  }
}

// Run with bounded concurrency so a large fleet never opens one socket per tenant at once.
async function pooled(items: Target[], limit: number, fn: (t: Target) => Promise<TargetResult>): Promise<TargetResult[]> {
  const out: TargetResult[] = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) out.push(await fn(items[i++]))
  })
  await Promise.all(workers)
  return out
}

export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const secret = process.env.CRON_SECRET!
  const body = await request.json().catch(() => null)
  const jobId = body?.jobId
  if (!isCronJobId(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
  const job = CRON_JOBS.find(j => j.id === jobId)!

  // Platform-only job: one run against the flagship.
  if (job.tenantScope === null) {
    const r = await runOne(job, { host: flagshipCronHost(), slug: 'flagship', base: cronSelfBase() }, secret)
    return NextResponse.json({ jobId, mode: 'platform', ran: 1, failed: r.status === 'failed' ? 1 : 0, results: [r] })
  }

  // Tenant-scoped: flagship + every active tenant whose plan grants job.tenantScope.
  const { listTenants } = await import('@/lib/tenant-registry')
  const { getTenantPlan } = await import('@/lib/auth/plan-gate')

  const tenants = await listTenants({ status: 'active' }).catch(() => [])
  const eligible: { id: string; slug: string }[] = []
  let skippedByPlan = 0
  for (const t of tenants) {
    if (!t.slug) continue
    const inPlan = await getTenantPlan(t.id)
      .then(p => p.scopes.has(job.tenantScope!))
      .catch(() => false)
    if (inPlan) eligible.push({ id: t.id, slug: t.slug })
    else skippedByPlan++
  }

  // One layout lookup for the whole run; it only matters when stores have their own base.
  const layouts =
    process.env.CRON_STORE_BASE && eligible.length
      ? await import('@controller/lib/compute/store').then(m => m.storeLayouts(eligible.map(t => t.id))).catch(() => new Map())
      : new Map()
  const targets: Target[] = [{ host: flagshipCronHost(), slug: 'flagship', base: cronFlagshipBase() }]
  const skipped: TargetResult[] = []
  for (const t of eligible) {
    const host = storeCronHost(t.slug)
    const target = storeCronTarget(t.slug, layouts.get(t.id) ?? 'services', job.path)
    if ('skip' in target) skipped.push({ host, slug: t.slug, status: 'skipped', detail: target.skip })
    else targets.push({ host, slug: t.slug, base: target.base })
  }

  const results = [...(await pooled(targets, CONCURRENCY, t => runOne(job, t, secret))), ...skipped]
  const failed = results.filter(r => r.status === 'failed')
  return NextResponse.json({
    jobId,
    mode: 'tenant',
    tenantScope: job.tenantScope,
    ran: targets.length,
    skippedByPlan,
    skipped: skipped.length,
    failed: failed.length,
    results,
  })
}
