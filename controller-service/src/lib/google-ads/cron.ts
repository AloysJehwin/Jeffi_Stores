import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { resolveGoogleAdsCreds, googleAdsEnvStatus } from './credentials'
import { syncGoogleAds, AdsSyncInProgressError, type AdsSyncMode } from './sync'

/** Shared handler for the nightly full sync and the intraday refresh (run per store by the fan-out). */
export async function handleAdsCron(req: NextRequest, mode: AdsSyncMode): Promise<NextResponse> {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!googleAdsEnvStatus().developerToken) return NextResponse.json({ skipped: 'not_configured' })
  try {
    await resolveGoogleAdsCreds()
  } catch {
    return NextResponse.json({ skipped: 'not_connected' })
  }
  try {
    const r = await syncGoogleAds(mode)
    return NextResponse.json({ status: r.status, rows: r.rows, errors: r.errors.length })
  } catch (e) {
    if (e instanceof AdsSyncInProgressError) return NextResponse.json({ skipped: 'running' })
    return NextResponse.json({ error: (e as Error)?.message || 'Sync failed' }, { status: 500 })
  }
}
