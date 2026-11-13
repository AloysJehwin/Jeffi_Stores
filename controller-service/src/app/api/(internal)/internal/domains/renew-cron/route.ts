import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runDomainRenewCron } from '@controller/lib/domains/renewal'

export const dynamic = 'force-dynamic'

// CRON_JOBS `domain_renew` (daily): open renewal windows, debit and renew, remind, expire unpaid domains.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await runDomainRenewCron()
  if (result.errors.length) console.warn('[domain-renew] errors', result.errors)
  return NextResponse.json({ ok: true, ...result })
}
