import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { CRON_JOBS, isCronJobId } from '@/lib/shared/cron-jobs'

export const dynamic = 'force-dynamic'

// Per-tenant cron fan-out. A single k8s CronJob calls this once per job; for a tenant-scoped job it
// runs the job route for the flagship AND every active tenant whose PLAN grants the job's
// tenantScope. Platform-only jobs (tenantScope === null) just run once against the flagship.
//
// Each per-tenant call hits the job's own route with that tenant's Host header, so the route's
// existing Host→tenant resolution routes getPool to the tenant DB and records run status in that
// tenant's own site_settings. Auth: bearer CRON_SECRET (verifyCronRequest).

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
const SELF_BASE = process.env.CRON_SELF_BASE || `http://127.0.0.1:${process.env.PORT || '3000'}`
const CONCURRENCY = Math.max(1, Number(process.env.CRON_FANOUT_CONCURRENCY || '5'))
const PER_CALL_TIMEOUT_MS = Number(process.env.CRON_FANOUT_TIMEOUT_MS || '280000')

const flagshipHost = () => ROOT_DOMAIN
const tenantHost = (slug: string) => `${slug}.${ROOT_DOMAIN}`

type TargetResult = { host: string; slug: string; status: 'ok' | 'failed'; detail?: string }

async function runOne(job: (typeof CRON_JOBS)[number], host: string, slug: string, secret: string): Promise<TargetResult> {
  try {
    const res = await fetch(`${SELF_BASE}${job.path}`, {
      method: job.method,
      headers: { Host: host, Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
    })
    if (!res.ok) return { host, slug, status: 'failed', detail: `HTTP ${res.status}` }
    return { host, slug, status: 'ok' }
  } catch (e: any) {
    return { host, slug, status: 'failed', detail: e?.message || 'fetch failed' }
  }
}

// Run with bounded concurrency so a large fleet never opens one socket per tenant at once.
async function pooled(items: { host: string; slug: string }[], limit: number, fn: (t: { host: string; slug: string }) => Promise<TargetResult>): Promise<TargetResult[]> {
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
    const r = await runOne(job, flagshipHost(), 'flagship', secret)
    return NextResponse.json({ jobId, mode: 'platform', ran: 1, failed: r.status === 'failed' ? 1 : 0, results: [r] })
  }

  // Tenant-scoped: flagship + every active tenant whose plan grants job.tenantScope.
  const { listTenants } = await import('@/lib/tenant-registry')
  const { getTenantPlan } = await import('@/lib/auth/plan-gate')

  const tenants = await listTenants({ status: 'active' }).catch(() => [])
  const targets: { host: string; slug: string }[] = [{ host: flagshipHost(), slug: 'flagship' }]
  let skipped = 0
  for (const t of tenants) {
    if (!t.slug) continue
    const inPlan = await getTenantPlan(t.id)
      .then(p => p.scopes.has(job.tenantScope!))
      .catch(() => false)
    if (inPlan) targets.push({ host: tenantHost(t.slug), slug: t.slug })
    else skipped++
  }

  const results = await pooled(targets, CONCURRENCY, t => runOne(job, t.host, t.slug, secret))
  const failed = results.filter(r => r.status === 'failed')
  return NextResponse.json({
    jobId,
    mode: 'tenant',
    tenantScope: job.tenantScope,
    ran: results.length,
    skippedByPlan: skipped,
    failed: failed.length,
    results,
  })
}
