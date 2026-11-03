import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { getAdsAccount } from '@/lib/google-ads/report'
import { sendWeeklyDigest } from '@/lib/google-ads/digest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Weekly per store (Monday morning): last 7 days vs the 7 before to owners/admins with Google Ads access.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const account = await getAdsAccount()
  if (!account?.last_sync_at) return NextResponse.json({ skipped: 'no_data' })
  try {
    return NextResponse.json(await sendWeeklyDigest())
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Digest failed' }, { status: 500 })
  }
}
