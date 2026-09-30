import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const dynamic = 'force-dynamic'

const VALID_JOBS: Record<string, { path: string; method: 'GET' | 'POST' }> = {
  delhivery_sync: { path: '/api/admin/delhivery/sync-statuses', method: 'POST' },
  cancel_stale_orders: { path: '/api/cron/cancel-stale-orders', method: 'GET' },
  sweep_auto_tasks: { path: '/api/cron/sweep-auto-tasks', method: 'GET' },
  run_campaigns: { path: '/api/cron/run-campaigns', method: 'GET' },
  compute_health: { path: '/api/cron/compute-health', method: 'GET' },
  daily_briefing: { path: '/api/cron/daily-briefing', method: 'GET' },
  retry_reversals: { path: '/api/cron/retry-reversals', method: 'GET' },
  wallet_drift: { path: '/api/cron/wallet-drift', method: 'GET' },
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'audit:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { jobId } = await request.json()
    const job = VALID_JOBS[jobId]
    if (!job) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })

    const cronSecret = process.env.CRON_SECRET
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
    if (!cronSecret || !appUrl) return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })

    const res = await fetch(`${appUrl}${job.path}`, {
      method: job.method,
      headers: { Authorization: `Bearer ${cronSecret}` },
    })

    return NextResponse.json({ ok: res.ok, status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
