import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runDomainOrdersCron } from '@controller/lib/domains/orders'

export const dynamic = 'force-dynamic'

// CRON_JOBS `domain_orders` (every 5 min): bought domains through charge → registration → DNS → certificates.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await runDomainOrdersCron()
  if (result.errors.length) console.warn('[domain-orders] errors', result.errors)
  return NextResponse.json({ ok: true, ...result })
}
