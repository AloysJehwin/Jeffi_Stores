import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { testGoogleAds } from '@/lib/integrations/test-connection'
import { adsTenantKey } from '@/lib/google-ads/credentials'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// One read-only call with the stored credentials (no side effects, so a GET on google_ads:read).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await testGoogleAds(await adsTenantKey()))
}
