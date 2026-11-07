import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { adsConsoleGet } from '@/lib/marketplace-ads/routes'

export const dynamic = 'force-dynamic'

/** ?tab=overview|campaigns|products|imports&from&to */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio_ads:read'), 'ajio_ads:read', 'AJIO Ads')
  if (admin instanceof NextResponse) return admin
  return adsConsoleGet(request, 'ajio_ads')
}
