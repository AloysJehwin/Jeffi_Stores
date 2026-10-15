import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listAdsChanges } from '@/lib/google-ads/mutate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Changes made from this console (who, when, what, result). Readable by anyone who sees the reports.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ changes: await listAdsChanges(200) })
}
