import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { adsImportPost } from '@/lib/marketplace-ads/routes'

export const dynamic = 'force-dynamic'

/** Report upload: ?step=preview (map and check) or ?step=commit (replace the report's period). */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra_ads:write'), 'myntra_ads:write', 'Myntra Ads')
  if (admin instanceof NextResponse) return admin
  return adsImportPost(request, 'myntra_ads', admin)
}
