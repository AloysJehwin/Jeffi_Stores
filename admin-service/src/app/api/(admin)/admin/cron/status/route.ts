import { NextRequest, NextResponse } from 'next/server'
import { CRON_JOBS } from '@/lib/shared/cron-jobs'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'audit:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const result = await query<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'cron_%'`
    )
    const settings: Record<string, string> = {}
    for (const row of result.rows) settings[row.key] = row.value

    // When a tenant is in context, mark which jobs its PLAN runs (tenantScope ∈ plan scopes).
    // Platform-only jobs (tenantScope === null) are platform infra → not a tenant's job.
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    const tenantId = await resolveTenantId().catch(() => null)
    let planScopes: Set<string> | null = null
    if (tenantId) {
      const { getTenantPlan } = await import('@/lib/auth/plan-gate')
      planScopes = await getTenantPlan(tenantId)
        .then(p => p.scopes)
        .catch(() => null)
    }
    const inPlanFor = (tenantScope: string | null): boolean => {
      if (!tenantId) return true // platform admin sees everything
      if (tenantScope === null) return false // platform-only job, not a tenant's
      return planScopes ? planScopes.has(tenantScope) : false
    }

    const JOBS = CRON_JOBS.map(j => ({
      id: j.id,
      name: j.name,
      path: j.path,
      intervalMs: j.intervalMs,
      intervalLabel: j.intervalLabel,
      tenantScope: j.tenantScope,
      inPlan: inPlanFor(j.tenantScope),
    }))

    const jobs = JOBS.map(job => {
      let log: Array<{ t: string; ok: boolean; err?: string }> = []
      try {
        log = JSON.parse(settings[`cron_log_${job.id}`] || '[]')
      } catch {
        log = []
      }
      return {
        ...job,
        enabled: settings[`cron_enabled_${job.id}`] !== 'false',
        lastRun: settings[`cron_last_run_${job.id}`] || null,
        lastStatus: settings[`cron_last_status_${job.id}`] || null,
        lastError: settings[`cron_last_error_${job.id}`] || null,
        log,
      }
    })

    return NextResponse.json({ jobs })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
