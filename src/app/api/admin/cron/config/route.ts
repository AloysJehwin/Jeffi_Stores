import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

const VALID_JOB_IDS = ['delhivery_sync', 'cancel_stale_orders', 'sweep_auto_tasks', 'run_campaigns', 'compute_health', 'daily_briefing']

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { jobId, enabled } = body

    if (!VALID_JOB_IDS.includes(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 })
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO site_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`cron_enabled_${jobId}`, String(enabled)]
      )
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
