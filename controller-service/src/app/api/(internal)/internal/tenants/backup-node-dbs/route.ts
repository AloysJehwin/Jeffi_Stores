import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { backupNodeDbs } from '@controller/lib/provisioning/node-db-backup'

export const dynamic = 'force-dynamic'

// CRON_JOBS `node_db_backup` (hourly; each on-server store database once a day). Auth: Bearer ${CRON_SECRET}.
// A store that could not be backed up fails the run, so the cron status page shows it.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await backupNodeDbs()
  return NextResponse.json({ ok: result.failed.length === 0, ...result }, { status: result.failed.length ? 500 : 200 })
}
