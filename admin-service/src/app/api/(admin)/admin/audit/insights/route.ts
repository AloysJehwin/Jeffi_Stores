import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

import { RISKY_ACTIONS } from '@/lib/overviews/audit'

export const dynamic = 'force-dynamic'

const KINDS = ['all', 'risky', 'create', 'update']
const RISKY = `l.action IN (${RISKY_ACTIONS.map(a => `'${a}'`).join(', ')})`

// Daily audit events by who acted (a team member, or the system when no admin is attached), optionally for one kind of
// action (risky = delete, import, export), behind the audit Overview's insights sheet. Same gate as the audit overview API.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'audit:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, KINDS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'admin_audit_log',
      alias: 'l',
      dateColumn: 'created_at',
      where: q.filter === 'all' ? undefined : q.filter === 'risky' ? RISKY : 'l.action = $1',
      params: q.filter === 'create' || q.filter === 'update' ? [q.filter] : [],
      series: [
        { key: 'team', label: 'Team members', where: 'l.admin_id IS NOT NULL' },
        { key: 'system', label: 'System', where: 'l.admin_id IS NULL' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('[audit insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
