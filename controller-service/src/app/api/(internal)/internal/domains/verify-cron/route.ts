import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runDomainVerifyCron } from '@controller/lib/domains/verify-cron'

export const dynamic = 'force-dynamic'

// CRON_JOBS `custom_domain_verify` (every 10 min). Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runDomainVerifyCron()
  return NextResponse.json({ ok: true, ...result })
}
