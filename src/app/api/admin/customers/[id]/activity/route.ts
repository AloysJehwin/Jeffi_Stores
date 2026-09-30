import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)))
  const before = req.nextUrl.searchParams.get('before')

  const wheres = ['cal.user_id = $1']
  const vals: any[] = [id]
  if (before) {
    wheres.push(`cal.created_at < $${vals.length + 1}`)
    vals.push(before)
  }
  vals.push(limit)

  const events = await queryMany(
    `
    SELECT
      cal.id, cal.kind, cal.reference_id, cal.reference_type,
      cal.summary, cal.metadata, cal.created_at,
      cal.actor_id,
      u.first_name AS actor_first_name, u.last_name AS actor_last_name,
      COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS actor_username
    FROM customer_activity_log cal
    LEFT JOIN admins a ON cal.actor_id = a.id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE ${wheres.join(' AND ')}
    ORDER BY cal.created_at DESC
    LIMIT $${vals.length}
  `,
    vals
  )

  return NextResponse.json({ events })
}
