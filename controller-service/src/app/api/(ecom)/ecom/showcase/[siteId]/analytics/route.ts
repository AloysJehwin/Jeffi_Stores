import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getOwnedShowcase } from '@/lib/showcase/store'
import { showcaseHost } from '@/lib/showcase/host'
import { trafficPeriod } from '@/lib/traffic/period'
import { leadsCsv, showcaseLeadRows, showcaseReport } from '@/lib/traffic/showcase-report'
import { SHOWCASE_TABS, type ShowcaseTab } from '@/lib/traffic/showcase-types'

export const dynamic = 'force-dynamic'

// A Showcase's analytics for its owner only: GET ?tab=overview|acquisition|behaviour|funnel|leads|audience|realtime
// &from&to (IST days), or ?format=csv for the period's enquiries as a spreadsheet.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const { siteId } = await params
  const site = UUID_RE.test(siteId) ? await getOwnedShowcase(siteId, ctx.owner.id) : null
  if (!site) return NextResponse.json({ error: 'Site not found.' }, { status: 404 })

  const sp = request.nextUrl.searchParams
  const period = trafficPeriod(sp.get('from'), sp.get('to'))
  const selfHosts = [showcaseHost(site.slug), ...(site.customDomain ? [site.customDomain] : [])]

  try {
    if (sp.get('format') === 'csv') {
      const csv = leadsCsv(await showcaseLeadRows(site.id, period, selfHosts))
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="enquiries-${site.slug}-${period.from}-to-${period.to}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    const tab = (sp.get('tab') || 'overview') as ShowcaseTab
    if (!SHOWCASE_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
    const data = await showcaseReport(tab, period, {
      siteId: site.id,
      selfHosts,
      tabHref: t => `/dashboard/showcase/${site.id}/analytics?tab=${t}`,
    })
    return NextResponse.json({ tab, ...data })
  } catch (err) {
    console.error('[ecom/showcase/analytics]', site.id, err)
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 })
  }
}
