import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { googleAdsEnvStatus } from '@/lib/google-ads/credentials'
import { uploadPendingConversions } from '@controller/lib/google-ads/ecom-conversions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Platform job: sends the pending ecom conversions (signup, Showcase published, first paid subscription) of owners who
// came from a Google ad to the flagship's own Google Ads account; failed ones are retried with a backoff.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!googleAdsEnvStatus().developerToken) return NextResponse.json({ skipped: 'not_configured' })
  try {
    return NextResponse.json(await uploadPendingConversions())
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Upload failed' }, { status: 500 })
  }
}
