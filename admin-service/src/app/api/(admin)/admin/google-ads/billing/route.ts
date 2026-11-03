import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { BILLING_URL, billingStatus, saveBillingStatus } from '@/lib/google-ads/account-create'
import { adsErrorResponse } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Billing state Google exposes for the connected account (live), mirrored onto ads_account.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  try {
    const b = await billingStatus(await googleAdsClientFor())
    await saveBillingStatus(b)
    return NextResponse.json({ ...b, billingUrl: BILLING_URL })
  } catch (e) {
    return adsErrorResponse(e)
  }
}
