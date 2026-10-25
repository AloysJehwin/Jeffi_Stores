import { NextRequest, NextResponse } from 'next/server'
import { pruneDevices } from '@/lib/push/devices'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Weekly: drop app installs not seen for 270 days (uninstalled, or never opened again).
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, pruned: await pruneDevices(270) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Prune failed' }, { status: 500 })
  }
}
