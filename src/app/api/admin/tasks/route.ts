import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const scope = req.nextUrl.searchParams.get('scope') || 'mine'
  const status = req.nextUrl.searchParams.get('status') || 'open'

  const wheres: string[] = []
  const vals: any[] = []

  if (scope === 'mine') {
    wheres.push(`ct.assigned_to = $${vals.length + 1}`)
    vals.push(admin.adminId)
  } else if (scope === 'unassigned') {
    wheres.push(`ct.assigned_to IS NULL`)
  }

  if (status === 'open') {
    wheres.push(`ct.status IN ('pending', 'in_progress')`)
  } else if (status === 'completed') {
    wheres.push(`ct.status = 'completed' AND ct.completed_at > NOW() - INTERVAL '30 days'`)
  } else if (status === 'overdue') {
    wheres.push(`ct.status IN ('pending', 'in_progress')`)
    wheres.push(`ct.due_date < CURRENT_DATE`)
  }

  const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''

  const tasks = await queryMany(`
    SELECT
      ct.id, ct.title, ct.description, ct.due_date, ct.priority, ct.status,
      ct.completed_at, ct.created_at,
      ct.auto_created, ct.source_kind, ct.source_ref_id,
      ct.user_id,
      cu.first_name AS customer_first_name, cu.last_name AS customer_last_name, cu.email AS customer_email,
      ct.assigned_to,
      au.first_name AS assigned_first_name, au.last_name AS assigned_last_name,
      a.username AS assigned_username
    FROM customer_tasks ct
    LEFT JOIN users cu ON ct.user_id = cu.id
    LEFT JOIN admins a ON ct.assigned_to = a.id
    LEFT JOIN users au ON au.id = a.user_id
    ${whereClause}
    ORDER BY
      CASE WHEN ct.status = 'completed' THEN 1 ELSE 0 END,
      ct.due_date NULLS LAST,
      CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      ct.created_at DESC
    LIMIT 200
  `, vals)

  return NextResponse.json({ tasks })
}
