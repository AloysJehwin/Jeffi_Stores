import { NextRequest, NextResponse } from 'next/server'
import { CRON_JOBS } from '@/lib/cron-jobs'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'

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

    const JOBS = CRON_JOBS.map(j => ({
      id: j.id,
      name: j.name,
      path: j.path,
      intervalMs: j.intervalMs,
      intervalLabel: j.intervalLabel,
      tenantScope: j.tenantScope,
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

    const SYSTEM_JOBS = [
      {
        id: 'certbot_renew',
        name: 'SSL cert renewal',
        schedule: '0 3 * * *',
        intervalLabel: 'daily at 03:00',
        description: 'certbot renew + restart jeffi-nginx',
        type: 'system' as const,
      },
      {
        id: 'backup_rds',
        name: 'RDS database backup',
        schedule: '30 20 * * *',
        intervalLabel: 'daily at 20:30',
        description: '/home/ec2-user/backup-rds.sh',
        type: 'system' as const,
      },
    ]

    return NextResponse.json({ jobs, systemJobs: SYSTEM_JOBS })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
