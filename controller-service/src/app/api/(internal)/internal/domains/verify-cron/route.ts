import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runDomainVerifyCron } from '@controller/lib/domains/verify-cron'

export const dynamic = 'force-dynamic'

// Runs every ~10 min from k8s CronJob `custom-domain-verify` (deploy/k8s/platform/custom-domain-cron.yaml).
// Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runDomainVerifyCron()
  return NextResponse.json({ ok: true, ...result })
}
