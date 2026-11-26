import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getOwnedShowcase } from '@/lib/showcase/store'
import { controlPlanePool } from '@/lib/tenant-registry'
import { parseInsightsQuery } from '@/lib/insights/series'
import { mergeInsightsSeries } from '@/lib/page-insights/merge'
import { poolInsightsSeries } from '@controller/lib/overviews/ecom-insights'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A Showcase's daily page views against the enquiries it received, for its owner only (the same gate as the analytics
// route), behind the analytics page's insights sheet.
export async function GET(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const { siteId } = await params
  const site = UUID_RE.test(siteId) ? await getOwnedShowcase(siteId, ctx.owner.id) : null
  if (!site) return NextResponse.json({ error: 'Site not found.' }, { status: 404 })
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const pool = controlPlanePool()
    const base = { alias: 'x', dateColumn: 'created_at', params: [site.id], weeks: q.weeks }
    const [views, leads] = await Promise.all([
      poolInsightsSeries(pool, { ...base, table: 'showcase_events', where: `x.site_id = $1 AND x.type = 'pageview'`, series: [{ key: 'views', label: 'Views' }] }),
      poolInsightsSeries(pool, { ...base, table: 'showcase_leads', where: 'x.site_id = $1', series: [{ key: 'leads', label: 'Enquiries' }] }),
    ])
    return NextResponse.json({ series: mergeInsightsSeries([views, leads]) })
  } catch (err) {
    console.error('[ecom/showcase/analytics/insights]', site.id, err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
