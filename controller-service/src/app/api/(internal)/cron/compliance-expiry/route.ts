import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runComplianceExpiry } from '@controller/lib/catalog/compliance-expiry'

export const dynamic = 'force-dynamic'

// CRON_JOBS `compliance_expiry` (daily): marks lapsed licences expired and emails owners 30 and 7 days before and once lapsed.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const run = await runComplianceExpiry()
  if (run.failed.length) console.warn('[compliance-expiry] not emailed', run.failed)
  return NextResponse.json({ ok: true, ...run })
}
