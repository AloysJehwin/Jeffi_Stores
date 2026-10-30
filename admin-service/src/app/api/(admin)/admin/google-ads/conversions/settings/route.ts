import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { setUploadApi } from '@/lib/google-ads/conversions/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({ uploadApi: z.enum(['data_manager', 'ads_api']) })

// Which API uploads this store's conversions: the Data Manager API (default), or the Google Ads API
// for a developer token Google still allows to upload click conversions.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose data_manager or ads_api' }, { status: 400 })
  const api = parsed.data.uploadApi
  if (!(await setUploadApi(api))) {
    return NextResponse.json({ error: 'Choose a conversion action first.' }, { status: 409 })
  }
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'system',
    entityId: null,
    summary: `Google Ads conversion uploads now use the ${api === 'ads_api' ? 'Google Ads API' : 'Data Manager API'}`,
    request,
  })
  return NextResponse.json({ ok: true, uploadApi: api })
}
