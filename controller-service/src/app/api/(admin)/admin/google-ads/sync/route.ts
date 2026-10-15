import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { syncGoogleAds, isAdsSyncRunning, AdsSyncInProgressError } from '@/lib/google-ads/sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ running: await isAdsSyncRunning() })
}

// "Sync now" from the console. 409 while another run (cron or manual) holds the lock.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const mode = request.nextUrl.searchParams.get('mode') === 'today' ? 'today' : 'full'
  try {
    return NextResponse.json(await syncGoogleAds(mode))
  } catch (e) {
    if (e instanceof AdsSyncInProgressError) return NextResponse.json({ error: e.message }, { status: 409 })
    return NextResponse.json({ error: (e as Error)?.message || 'Sync failed' }, { status: 500 })
  }
}
