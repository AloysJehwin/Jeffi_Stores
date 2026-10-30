import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, readJson, withPlan } from '@/lib/channels/route'
import { refreshMerchantReports } from '@/lib/merchant/reports'
import { refreshGmcStatusSnapshot } from '@/lib/merchant/gmc-status'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { GMC_RULES } from '@/lib/merchant/alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Run now: reports (performance, prices, best sellers, account) or the product status snapshot. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'merchant_sync:write'), 'merchant_sync:write', 'Google Merchant')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  try {
    if (body?.kind === 'status') {
      const r = await refreshGmcStatusSnapshot()
      if ('locked' in r) return NextResponse.json({ error: 'A status refresh is already running.' }, { status: 409 })
      return NextResponse.json({ status: 'success', summary: r, alerts: await runChannelAlerts(GMC_RULES) })
    }
    const r = await refreshMerchantReports()
    return NextResponse.json({ ...r, alerts: await runChannelAlerts(GMC_RULES) })
  } catch (e) {
    return channelError(e, 'Connect Google Merchant Center first.')
  }
}
