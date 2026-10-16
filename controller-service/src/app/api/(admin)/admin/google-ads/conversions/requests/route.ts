import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listDataManagerRequests } from '@/lib/google-ads/conversions/requests'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Recent Data Manager upload requests and Google's processing status for each (polled by the job).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json({ requests: await listDataManagerRequests(Number(request.nextUrl.searchParams.get('limit')) || 20) })
  } catch (e: any) {
    console.error('[google-ads/conversions/requests]', e?.message)
    return NextResponse.json({ error: 'Could not load the upload requests' }, { status: 500 })
  }
}
