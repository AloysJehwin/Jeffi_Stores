import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status')
  const wheres = ['ct.user_id = $1']
  const vals: any[] = [id]
  if (status === 'open') {
    wheres.push(`ct.status IN ('pending', 'in_progress')`)
  } else if (status === 'completed') {
    wheres.push(`ct.status = 'completed'`)
  }

  const tasks = await queryMany(`
    SELECT
      ct.id, ct.title, ct.description, ct.due_date, ct.priority, ct.status,
      ct.completed_at, ct.created_at, ct.updated_at,
      ct.auto_created, ct.source_kind, ct.source_ref_id,
      COALESCE(NULLIF(TRIM(cuser.first_name || ' ' || cuser.last_name), ''), cuser.email) AS created_by_username,
      cuser.first_name AS created_by_first_name, cuser.last_name AS created_by_last_name,
      COALESCE(NULLIF(TRIM(auser.first_name || ' ' || auser.last_name), ''), auser.email) AS assigned_to_username,
      auser.first_name AS assigned_to_first_name, auser.last_name AS assigned_to_last_name,
      ct.assigned_to
    FROM customer_tasks ct
    LEFT JOIN admins ca ON ct.created_by = ca.id
    LEFT JOIN users cuser ON ca.user_id = cuser.id
    LEFT JOIN admins aa ON ct.assigned_to = aa.id
    LEFT JOIN users auser ON aa.user_id = auser.id
    WHERE ${wheres.join(' AND ')}
    ORDER BY
      CASE ct.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      ct.due_date NULLS LAST,
      ct.created_at DESC
    LIMIT 100
  `, vals)

  return NextResponse.json({ tasks })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { title, description, due_date, priority, assigned_to } = await req.json()
  const trimmedTitle = String(title || '').trim().slice(0, 255)
  if (!trimmedTitle) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const validPriorities = ['low', 'medium', 'high', 'urgent']
  const finalPriority = validPriorities.includes(priority) ? priority : 'medium'

  const result = await query<{ id: string }>(
    `INSERT INTO customer_tasks (user_id, created_by, assigned_to, title, description, due_date, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      id,
      admin.adminId,
      assigned_to || admin.adminId,
      trimmedTitle,
      description ? String(description).trim().slice(0, 2000) : null,
      due_date || null,
      finalPriority,
    ]
  )

  logActivity({
    userId: id,
    actorId: admin.adminId,
    kind: 'task_created',
    referenceId: result.rows[0]?.id,
    referenceType: 'customer_tasks',
    summary: `Task created: ${trimmedTitle}`,
    metadata: { priority: finalPriority, due_date: due_date || null },
  }).catch(() => {})

  return NextResponse.json({ success: true, taskId: result.rows[0]?.id })
}
