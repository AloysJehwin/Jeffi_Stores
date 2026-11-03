import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { CRON_JOBS, isCronJobId } from '@/lib/shared/cron-jobs'
import { resolveTenant, runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { getTenantPlan } from '@/lib/auth/plan-gate'
import { recordCronRun } from '@/lib/shared/cron-record'

export const dynamic = 'force-dynamic'

// Static jobId → route-module import map. Fully literal specifiers so both the webpack prod build and
// Turbopack dev reliably bundle them (an interpolated import() is flagged by vite:dynamic-import-vars
// and may not trace). Store jobs only: platform jobs live in the controller.
const JOB_ROUTE_IMPORTS: Record<string, () => Promise<Record<string, any>>> = {
  delhivery_sync: () => import('@admin/app/api/(admin)/admin/delhivery/sync-statuses/route'),
  cancel_stale_orders: () => import('@admin/app/api/(internal)/cron/cancel-stale-orders/route'),
  sweep_auto_tasks: () => import('@admin/app/api/(internal)/cron/sweep-auto-tasks/route'),
  dispatch_mailer: () => import('@admin/app/api/(internal)/cron/dispatch-mailer/route'),
  run_campaigns: () => import('@admin/app/api/(internal)/cron/run-campaigns/route'),
  compute_health: () => import('@admin/app/api/(internal)/cron/compute-health/route'),
  daily_briefing: () => import('@admin/app/api/(internal)/cron/daily-briefing/route'),
  publish_social_posts: () => import('@admin/app/api/(internal)/cron/publish-social-posts/route'),
  customer_notes_digest: () => import('@admin/app/api/(internal)/cron/customer-notes-digest/route'),
  loyalty_reconcile: () => import('@admin/app/api/(internal)/cron/loyalty-reconcile/route'),
  sweep_idle_sessions: () => import('@admin/app/api/(internal)/cron/sweep-sessions/route'),
  embed_sync: () => import('@admin/app/api/(internal)/cron/embed-sync/route'),
}

// Manually run ONE cron job for the CURRENT store, IN-PROCESS under that store's tenant context.
// Why in-process: an HTTP self-call to 127.0.0.1 can't carry tenant identity — Node fetch ignores a
// Host override and middleware re-derives x-tenant-slug from the connection host, so the call always
// resolves to the flagship. db.ts resolves the tenant ALS-first (getCurrentTenant), so wrapping the
// job handler + the run-record in runWithTenantContext makes every query hit the right store's DB,
// in dev and prod alike. Does NOT fan out across the fleet — a tenant admin only runs its own store.
export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'audit:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { jobId } = await request.json()
    if (!isCronJobId(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
    const job = CRON_JOBS.find(j => j.id === jobId)!

    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })

    // Current store: a tenant triggers only its OWN store; the flagship runs with no tenant context.
    const tenant = await resolveTenant().catch(() => null)

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

    // Synthetic request carrying the cron bearer so the handler's verifyCronRequest passes
    // (cron-auth checks the bearer only — no Host). Internal URL; the handler reads nothing else.
    const jobReq = new NextRequest(`http://127.0.0.1${job.path}`, {
      method: job.method,
      headers: { Authorization: `Bearer ${cronSecret}` },
    })

    const run = async (): Promise<{ ok: boolean; errorMsg?: string; detail?: unknown }> => {
      let ok = false
      let errorMsg: string | undefined
      let detail: unknown
      try {
        let res: Response
        if (job.tenantScope === null) {
          // Platform jobs need no store context and run on the controller.
          const controller = process.env.CONTROLLER_URL || 'http://127.0.0.1:3000'
          res = await fetch(`${controller}${job.path}`, { method: job.method, headers: { Authorization: `Bearer ${cronSecret}` } })
        } else {
          const loader = JOB_ROUTE_IMPORTS[jobId]
          if (!loader) throw new Error(`No route module mapped for ${jobId}`)
          const handler = (await loader())?.[job.method]
          if (typeof handler !== 'function') throw new Error(`No ${job.method} handler for ${job.path}`)
          res = await handler(jobReq)
        }
        ok = res.ok
        if (!ok) errorMsg = `HTTP ${res.status}`
        detail = await res.json().catch(() => undefined)
      } catch (e: any) {
        ok = false
        errorMsg = e?.message || 'job failed'
      }
      // Record into THIS store's site_settings (same ALS context → same DB) so the tab reflects it.
      await recordCronRun(jobId, ok, errorMsg, detail).catch(() => {})
      return { ok, errorMsg, detail }
    }

    const result = tenant ? await runWithTenantContext(tenant as TenantContext, run) : await run()
    return NextResponse.json({ ok: result.ok, error: result.ok ? undefined : result.errorMsg })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
