import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'
import { mergeInsightsSeries } from '@/lib/page-insights/merge'

export const dynamic = 'force-dynamic'

// Team members who signed in per day against the actions the team took (the audit log's admin rows), behind the team
// Overview's insights sheet. Owner-only, like the team overview API.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const [members, actions] = await Promise.all([
      getInsightsSeries({
        table: 'auth_sessions',
        alias: 's',
        dateColumn: 'created_at',
        joins: 'JOIN admins a ON a.id = s.principal_id',
        where: `s.principal_type = 'admin' AND a.role IS DISTINCT FROM 'service_account'`,
        series: [{ key: 'members', label: 'Members signed in', value: 'COUNT(DISTINCT s.principal_id)' }],
        weeks: q.weeks,
      }),
      getInsightsSeries({
        table: 'admin_audit_log',
        alias: 'l',
        dateColumn: 'created_at',
        series: [{ key: 'actions', label: 'Actions', where: 'l.admin_id IS NOT NULL' }],
        weeks: q.weeks,
      }),
    ])
    return NextResponse.json({ series: mergeInsightsSeries([members, actions]) })
  } catch (err) {
    console.error('[team insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
