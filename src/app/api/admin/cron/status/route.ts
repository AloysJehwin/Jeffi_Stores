import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const result = await query<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'cron_%'`
    )
    const settings: Record<string, string> = {}
    for (const row of result.rows) settings[row.key] = row.value

    const JOBS = [
      { id: 'delhivery_sync', name: 'Delhivery status sync', path: '/api/admin/delhivery/sync-statuses', intervalMs: 10 * 60 * 1000, intervalLabel: 'every 10 min' },
      { id: 'cancel_stale_orders', name: 'Cancel stale orders', path: '/api/cron/cancel-stale-orders', intervalMs: 60 * 1000, intervalLabel: 'every 1 min' },
      { id: 'sweep_auto_tasks', name: 'Sweep auto tasks', path: '/api/cron/sweep-auto-tasks', intervalMs: 30 * 60 * 1000, intervalLabel: 'every 30 min' },
      { id: 'run_campaigns', name: 'Run campaigns', path: '/api/cron/run-campaigns', intervalMs: 30 * 60 * 1000, intervalLabel: 'every 30 min' },
      { id: 'compute_health', name: 'Compute store health', path: '/api/cron/compute-health', intervalMs: 30 * 60 * 1000, intervalLabel: 'every 30 min' },
      { id: 'daily_briefing', name: 'Daily briefing email', path: '/api/cron/daily-briefing', intervalMs: 24 * 60 * 60 * 1000, intervalLabel: 'every 24 h' },
    ]

    const jobs = JOBS.map(job => {
      let log: Array<{ t: string; ok: boolean; err?: string }> = []
      try { log = JSON.parse(settings[`cron_log_${job.id}`] || '[]') } catch { log = [] }
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
