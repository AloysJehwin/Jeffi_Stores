import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { AMAZON_TABS, loadAmazonTab, type AmazonTab } from '@/lib/amazon/console'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon:read'), 'amazon:read', 'The Amazon console')
  if (admin instanceof NextResponse) return admin
  const tab = (request.nextUrl.searchParams.get('tab') ?? 'overview') as AmazonTab
  if (!AMAZON_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  try {
    return NextResponse.json({ data: await loadAmazonTab(tab) })
  } catch (e) {
    return channelError(e, 'Connect Amazon first.')
  }
}
