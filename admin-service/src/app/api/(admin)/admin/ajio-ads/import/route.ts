import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { adsImportPost } from '@/lib/marketplace-ads/routes'

export const dynamic = 'force-dynamic'

/** Report upload: ?step=preview (map and check) or ?step=commit (replace the report's period). */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio_ads:write'), 'ajio_ads:write', 'AJIO Ads')
  if (admin instanceof NextResponse) return admin
  return adsImportPost(request, 'ajio_ads', admin)
}
