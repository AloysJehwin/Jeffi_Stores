import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { adsConsoleGet } from '@/lib/marketplace-ads/routes'

export const dynamic = 'force-dynamic'

/** ?tab=overview|campaigns|products|imports&from&to */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart_ads:read'), 'flipkart_ads:read', 'Flipkart Ads')
  if (admin instanceof NextResponse) return admin
  return adsConsoleGet(request, 'flipkart_ads')
}
