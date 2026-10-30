import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { TASKS_ENTITY } from '@/lib/filters/entities/tasks'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // The list's filters. Without ?scope / ?status the API keeps its old default, my open tasks;
  // "all" (not a filter value) turns either off.
  const sp = new URLSearchParams(req.nextUrl.searchParams)
  if (!sp.has('scope')) sp.set('scope', 'mine')
  if (!sp.has('status')) sp.set('status', 'open')
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
  const { where: whereClause, params: vals } = buildWhere(TASKS_ENTITY, normalizeQuery(TASKS_ENTITY, sp), 1, {
    ctx: { adminId: admin.adminId },
  })

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*) AS total FROM customer_tasks ct ${whereClause}`,
    vals
  )

  const total = parseInt(countRow?.total || '0', 10)
  const offset = (page - 1) * PAGE_SIZE

  const tasks = await queryMany(
    `
    SELECT
      ct.id, ct.title, ct.description, ct.due_date, ct.priority, ct.status,
      ct.completed_at, ct.created_at,
      ct.auto_created, ct.source_kind, ct.source_ref_id,
      ct.user_id,
      cu.first_name AS customer_first_name, cu.last_name AS customer_last_name, cu.email AS customer_email,
      ct.assigned_to,
      au.first_name AS assigned_first_name, au.last_name AS assigned_last_name,
      COALESCE(NULLIF(TRIM(au.first_name || ' ' || au.last_name), ''), au.email) AS assigned_username
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
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `,
    vals
  )

  return NextResponse.json({ tasks, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) })
}
