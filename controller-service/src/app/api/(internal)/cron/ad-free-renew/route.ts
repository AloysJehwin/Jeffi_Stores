import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { buyAdFreeMonth, tenantsDueForAdFreeRenewal } from '@/lib/billing/ad-free'

export const dynamic = 'force-dynamic'

// Daily: charges the next ad-free month for tenants on auto-renew. A short wallet leaves the month to
// lapse (ads return) and is retried each day for a week, so a top-up brings ad-free back.
export async function POST(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const due = await tenantsDueForAdFreeRenewal()
  const failed: { tenantId: string; error: string }[] = []
  let renewed = 0
  for (const tenantId of due) {
    const r = await buyAdFreeMonth(tenantId, { renew: true, reason: 'renewal' }).catch(e => ({
      ok: false as const,
      error: String(e?.message || e),
    }))
    if (r.ok) renewed += r.charged ? 1 : 0
    else failed.push({ tenantId, error: r.error })
  }
  if (failed.length) console.warn('[ad-free-renew] not renewed', failed)
  return NextResponse.json({ due: due.length, renewed, failed })
}
