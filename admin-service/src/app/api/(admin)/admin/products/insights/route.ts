import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS = ['all', 'simple', 'variants']
const WHERE: Record<string, string | undefined> = {
  all: undefined,
  simple: 'NOT COALESCE(p.has_variants, false)',
  variants: 'COALESCE(p.has_variants, false)',
}

/** Products added per day by state, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, FILTERS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'products',
      alias: 'p',
      dateColumn: 'created_at',
      joins: 'LEFT JOIN categories c ON c.id = p.category_id',
      where: WHERE[q.filter!],
      series: [
        { key: 'live', label: 'Live', where: 'p.is_active IS TRUE AND NOT p.is_draft' },
        { key: 'draft', label: 'Drafts', where: 'p.is_draft' },
        { key: 'inactive', label: 'Inactive', where: 'p.is_active IS NOT TRUE AND NOT p.is_draft' },
      ],
      top: { label: 'c.name' },
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[products insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
