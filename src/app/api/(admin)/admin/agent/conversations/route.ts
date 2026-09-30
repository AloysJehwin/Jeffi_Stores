import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100)

  const rows = await queryMany<{
    id: string
    title: string | null
    preview: string | null
    last_message_at: string
    message_count: number
  }>(
    `SELECT
       conv.conversation_id::text AS id,
       conv.first_user_msg AS preview,
       NULL::text AS title,
       conv.last_at::text AS last_message_at,
       conv.n::int AS message_count
     FROM (
       SELECT
         conversation_id,
         MAX(created_at) AS last_at,
         COUNT(*) AS n,
         (SELECT content FROM admin_agent_messages m2
            WHERE m2.conversation_id = m1.conversation_id AND m2.role = 'user'
            ORDER BY m2.created_at ASC LIMIT 1) AS first_user_msg
       FROM admin_agent_messages m1
       WHERE admin_id = $1::uuid
       GROUP BY conversation_id
     ) conv
     ORDER BY conv.last_at DESC
     LIMIT $2`,
    [admin.adminId, limit]
  )

  return NextResponse.json({ items: rows })
}
