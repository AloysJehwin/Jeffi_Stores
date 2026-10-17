import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { MERCHANT_TABS, loadMerchantTab, type MerchantTab } from '@/lib/merchant/console-data'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'merchant_sync:read'), 'merchant_sync:read', 'Google Merchant')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const tab = (sp.get('tab') ?? 'overview') as MerchantTab
  if (!MERCHANT_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!DATE.test(from) || !DATE.test(to) || from > to) return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  try {
    return NextResponse.json({ data: await loadMerchantTab(tab, { from, to }) })
  } catch (e) {
    return channelError(e, 'Connect Google Merchant Center first.')
  }
}
