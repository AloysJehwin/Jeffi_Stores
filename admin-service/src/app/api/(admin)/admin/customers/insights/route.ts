import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS = ['all', 'email', 'google']
const BASE = 'u.merged_to_user_id IS NULL'
const WHERE: Record<string, string> = {
  all: BASE,
  email: `${BASE} AND COALESCE(u.auth_provider, 'email') = 'email'`,
  google: `${BASE} AND u.auth_provider = 'google'`,
}

/** New accounts and guests per day, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'customers:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, FILTERS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'users',
      alias: 'u',
      dateColumn: 'created_at',
      where: WHERE[q.filter!],
      series: [
        { key: 'accounts', label: 'Accounts', where: 'u.is_guest IS NOT TRUE' },
        { key: 'guests', label: 'Guests', where: 'u.is_guest IS TRUE' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[customers insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
