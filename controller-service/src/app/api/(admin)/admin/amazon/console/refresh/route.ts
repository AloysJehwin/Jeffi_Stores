import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, readJson, withPlan } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { AMAZON_RULES } from '@/lib/amazon/alerts'
import { refreshFees, refreshOffers } from '@/lib/amazon/console'
import { refreshAmazonStatusSnapshot } from '@/lib/amazon/status'
import { runAmazonReports } from '@/lib/amazon/reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Run now: listing status, Buy Box offers or fee estimates. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon:write'), 'amazon:write', 'The Amazon console')
  if (admin instanceof NextResponse) return admin
  const kind = (await readJson(request))?.kind
  try {
    if (kind === 'status') {
      const r = await refreshAmazonStatusSnapshot()
      if ('locked' in r) return NextResponse.json({ error: 'A status refresh is already running.' }, { status: 409 })
      return NextResponse.json({ status: 'success', summary: r, alerts: await runChannelAlerts(AMAZON_RULES) })
    }
    if (kind === 'reports') {
      const r = await runAmazonReports()
      return NextResponse.json({ ...r, alerts: await runChannelAlerts(AMAZON_RULES) })
    }
    if (kind !== 'offers' && kind !== 'fees') return NextResponse.json({ error: 'Unknown refresh' }, { status: 400 })
    const r = kind === 'offers' ? await refreshOffers() : await refreshFees()
    return NextResponse.json({ ...r, alerts: await runChannelAlerts(AMAZON_RULES) })
  } catch (e) {
    return channelError(e, 'Connect Amazon first.')
  }
}
