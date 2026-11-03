import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { checkDataManagerSetup } from '@/lib/google-ads/conversions/setup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// "Check setup": a validate-only upload to the chosen action. Nothing is sent to Google Ads.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await checkDataManagerSetup())
  } catch (e) {
    if (e instanceof IntegrationNotConnectedError) return NextResponse.json({ error: 'Google Ads is not connected' }, { status: 409 })
    return NextResponse.json({ error: (e as Error)?.message || 'Could not check the setup' }, { status: 502 })
  }
}
