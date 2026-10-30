import { NextRequest, NextResponse } from 'next/server'
import { reconcileLoyalty } from '@/lib/loyalty/reconcile'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await reconcileLoyalty()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Loyalty reconcile failed' },
      { status: 500 }
    )
  }
}
