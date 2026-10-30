import { NextRequest, NextResponse } from 'next/server'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { AGENT_LOG_ENTITY } from '@/lib/filters/entities/agent'
import { LOG_COUNT_CAP } from '@/lib/filters/fields/audit'
import { cappedCount } from '@/lib/filters/run'
import { listWindow } from '@/lib/filters/window'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '50', 10)))
    const offset = (page - 1) * pageSize

    // The list filters; without dates, the last 30 days. The count stops at LOG_COUNT_CAP.
    const { q, window } = listWindow(AGENT_LOG_ENTITY, normalizeQuery(AGENT_LOG_ENTITY, searchParams))
    const w = buildWhere(AGENT_LOG_ENTITY, q)
    const n = w.params.length

    const [result, counted] = await Promise.all([
      query<any>(
        `SELECT
          am.id, am.conversation_id, am.created_at, am.tool_calls,
          COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) as admin_username,
          u.first_name as admin_first_name, u.last_name as admin_last_name
         FROM admin_agent_messages am
         LEFT JOIN admins a ON a.id = am.admin_id
         LEFT JOIN users u ON u.id = a.user_id
         ${w.where}
         ORDER BY am.created_at DESC
         LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...w.params, pageSize, offset]
      ),
      cappedCount(AGENT_LOG_ENTITY, q, LOG_COUNT_CAP),
    ])

    return NextResponse.json({ messages: result.rows, total: counted.count, capped: counted.capped, window })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
