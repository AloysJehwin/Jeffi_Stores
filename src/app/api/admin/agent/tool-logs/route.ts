import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '50', 10)))
    const offset = (page - 1) * pageSize

    const result = await query<any>(
      `SELECT
        m.id, m.conversation_id, m.created_at, m.tool_calls,
        COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) as admin_username,
        u.first_name as admin_first_name, u.last_name as admin_last_name
       FROM admin_agent_messages m
       LEFT JOIN admins a ON a.id = m.admin_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE m.role = 'assistant' AND jsonb_array_length(m.tool_calls) > 0
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    )

    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*) as total FROM admin_agent_messages WHERE role = 'assistant' AND jsonb_array_length(tool_calls) > 0`
    )

    return NextResponse.json({
      messages: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
