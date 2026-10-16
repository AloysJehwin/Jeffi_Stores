import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { ADS_TABS, loadTab, parseRange, type AdsTab } from '@/lib/google-ads/report'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const tab = (sp.get('tab') || 'overview') as AdsTab
  if (!ADS_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  const range = parseRange(sp.get('from'), sp.get('to'))
  try {
    return NextResponse.json({ tab, range, data: await loadTab(tab, range) })
  } catch (e: any) {
    console.error('[google-ads/report]', tab, e?.message)
    return NextResponse.json({ error: 'Could not load the report' }, { status: 500 })
  }
}
