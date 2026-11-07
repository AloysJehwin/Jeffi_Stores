import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { googleAdsEnvStatus, resolveGoogleAdsCreds } from '@/lib/google-ads/credentials'
import { AudienceRefreshInProgressError, refreshAudiences } from '@/lib/google-ads/audiences/refresh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Daily per store: rebuild each enabled Customer Match segment and send the difference to Google.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let creds: Awaited<ReturnType<typeof resolveGoogleAdsCreds>> | undefined
  try {
    creds = await resolveGoogleAdsCreds()
  } catch {
    return NextResponse.json({ skipped: 'not_connected' })
  }
  // The store's own developer token, else the platform's.
  if (!creds?.developerToken && !googleAdsEnvStatus().developerToken) return NextResponse.json({ skipped: 'not_configured' })
  try {
    const r = await refreshAudiences()
    return NextResponse.json({ status: r.status, segments: r.segments.length })
  } catch (e) {
    if (e instanceof AudienceRefreshInProgressError) return NextResponse.json({ skipped: 'running' })
    return NextResponse.json({ error: (e as Error)?.message || 'Refresh failed' }, { status: 500 })
  }
}
