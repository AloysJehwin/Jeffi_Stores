import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { purgeTrash } from '@/lib/drive/files'

export const dynamic = 'force-dynamic'

// Daily: Drive files in the trash for 30 days are deleted for good (storage and quota released).
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, purged: await purgeTrash(30) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Purge failed' }, { status: 500 })
  }
}
