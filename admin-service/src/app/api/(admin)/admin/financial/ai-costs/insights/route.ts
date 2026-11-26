import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

const CAPABILITIES = ['text', 'vision', 'embed', 'image', 'video', 'audio']
const CHARGED = `u.status IN ('ok', 'pending') AND COALESCE(u.wallet_ref, '') NOT LIKE 'platform:%'`

// Daily AI spend (rupees) by capability, behind the AI costs tab's insights sheet. Mirrors the tab's amount: the
// platform's cost on the flagship, what the store was charged elsewhere. Same gate as the ai-costs API.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const tenantId = request.headers.get('x-tenant-id')
    const flagship = !tenantId || tenantId === FLAGSHIP_TENANT_ID
    const amount = flagship ? 'u.cost_inr' : `CASE WHEN ${CHARGED} THEN u.price_inr ELSE 0 END`
    const series = await getInsightsSeries({
      table: 'ai_usage',
      alias: 'u',
      dateColumn: 'created_at',
      series: CAPABILITIES.map(c => ({ key: c, label: c[0].toUpperCase() + c.slice(1), value: `SUM(${amount})`, where: `u.capability = '${c}'` })),
      weeks: q.weeks,
    })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('[ai-costs insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
