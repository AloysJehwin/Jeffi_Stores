import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'
import { mergeInsightsSeries } from '@/lib/page-insights/merge'

export const dynamic = 'force-dynamic'

const PRIORITIES = ['all', 'urgent', 'high', 'medium', 'low']

// Tasks created per day against tasks completed per day (two date columns, so two queries merged), optionally for
// one priority, behind the tasks Overview's insights sheet. Same gate as the tasks overview API.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'customers:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, PRIORITIES)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const all = q.filter === 'all'
    const base = { table: 'customer_tasks', alias: 'ct', params: all ? [] : [q.filter], weeks: q.weeks, filter: q.filter }
    const priority = all ? '' : ' AND ct.priority = $1'
    const [created, completed] = await Promise.all([
      getInsightsSeries({ ...base, dateColumn: 'created_at', where: all ? undefined : 'ct.priority = $1', series: [{ key: 'created', label: 'Created' }] }),
      getInsightsSeries({ ...base, dateColumn: 'completed_at', where: `ct.status = 'completed'${priority}`, series: [{ key: 'completed', label: 'Completed' }] }),
    ])
    return NextResponse.json({ series: mergeInsightsSeries([created, completed]) })
  } catch (err) {
    console.error('[tasks insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
