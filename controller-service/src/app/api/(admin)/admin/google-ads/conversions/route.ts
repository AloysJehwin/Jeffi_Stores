import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listConversionUploads } from '@/lib/google-ads/conversions/console'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The server-side conversion upload log (filter by status / kind / order number, paged).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(
      await listConversionUploads({
        status: sp.get('status'),
        kind: sp.get('kind'),
        q: sp.get('q'),
        page: Number(sp.get('page')) || 1,
        pageSize: Number(sp.get('pageSize')) || 25,
      })
    )
  } catch (e: any) {
    console.error('[google-ads/conversions]', e?.message)
    return NextResponse.json({ error: 'Could not load the upload log' }, { status: 500 })
  }
}
