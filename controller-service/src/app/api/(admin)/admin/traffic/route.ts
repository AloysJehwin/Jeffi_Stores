import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { trafficReport } from '@/lib/traffic/report'
import { trafficPeriod } from '@/lib/traffic/period'
import { selfHostsFor } from '@/lib/traffic/channels'
import { TRAFFIC_TABS, type TrafficTab } from '@/lib/traffic/types'

export const dynamic = 'force-dynamic'

/** GET ?tab=overview|acquisition|behaviour|funnel|products|search|audience|realtime&from&to (IST days). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminScope(req, 'traffic:read')
  if (auth instanceof NextResponse) return auth

  const sp = req.nextUrl.searchParams
  const tab = (sp.get('tab') || 'overview') as TrafficTab
  if (!TRAFFIC_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  const period = trafficPeriod(sp.get('from'), sp.get('to'))
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')

  try {
    const data = await trafficReport(tab, period, { selfHosts: selfHostsFor(host, process.env.NEXT_PUBLIC_BASE_URL) })
    return NextResponse.json({ tab, ...data })
  } catch (err) {
    console.error('[admin/traffic]', tab, err)
    return NextResponse.json({ error: 'Failed to load traffic' }, { status: 500 })
  }
}
