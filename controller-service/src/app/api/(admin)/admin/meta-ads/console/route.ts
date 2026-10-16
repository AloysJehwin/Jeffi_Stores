import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { MADS_TABS, loadMadsTab, type MadsTab } from '@/lib/meta-ads/console'

export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:read'), 'meta_ads:read', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const tab = (sp.get('tab') ?? 'overview') as MadsTab
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!MADS_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  if (!DATE.test(from) || !DATE.test(to) || from > to) return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  try {
    return NextResponse.json({ data: await loadMadsTab(tab, { from, to }) })
  } catch (e) {
    return channelError(e, 'Connect Meta Ads first.')
  }
}
