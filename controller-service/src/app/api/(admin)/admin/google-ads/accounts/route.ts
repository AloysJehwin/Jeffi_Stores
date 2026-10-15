import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { adsTenantKey, readAdsConfig } from '@/lib/google-ads/credentials'
import { GoogleAdsClient } from '@/lib/google-ads/client'
import { listSelectableAccounts } from '@/lib/google-ads/accounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Accounts the signed-in Google user can pick from (manager accounts expand to their clients).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const cfg = await readAdsConfig(await adsTenantKey())
  if (!cfg?.oauth_refresh_token) return NextResponse.json({ error: 'Sign in with Google first.' }, { status: 400 })
  try {
    // customerId is unused by listAccessibleCustomers; each account gets its own client.
    const base = new GoogleAdsClient({ refreshToken: cfg.oauth_refresh_token, customerId: '0', retryDelays: [] })
    return NextResponse.json(await listSelectableAccounts(base))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not list Google Ads accounts' }, { status: 502 })
  }
}
