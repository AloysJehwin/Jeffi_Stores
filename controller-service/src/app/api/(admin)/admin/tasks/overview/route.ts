import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getTaskOverview } from '@/lib/overviews/tasks'
import { TASKS_ENTITY } from '@/lib/filters/entities/tasks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'customers:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    // The list's filters, but not its created date (the period owns from / to) nor its My tasks /
    // Open presets: the overview is the team's open, overdue and completed work.
    const scope = filterScope(TASKS_ENTITY, normalizeQuery(TASKS_ENTITY, sp), {
      omit: ['created', 'scope', 'status'],
      ctx: { adminId: admin.adminId },
    })
    return NextResponse.json(await getTaskOverview(parsePeriod(sp.get('from'), sp.get('to')), scope))
  } catch (err) {
    console.error('[tasks overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
