import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json()
  const { title, description, due_date, priority, status, assigned_to } = body

  const current = await queryOne<{ status: string; title: string }>(
    `SELECT status, title FROM customer_tasks WHERE id = $1 AND user_id = $2`,
    [taskId, id]
  )
  if (!current) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const updates: string[] = ['updated_at = NOW()']
  const vals: any[] = []
  let i = 1

  if (title !== undefined) {
    updates.push(`title = $${i++}`)
    vals.push(String(title).trim().slice(0, 255))
  }
  if (description !== undefined) {
    updates.push(`description = $${i++}`)
    vals.push(description ? String(description).trim().slice(0, 2000) : null)
  }
  if (due_date !== undefined) {
    updates.push(`due_date = $${i++}`)
    vals.push(due_date || null)
  }
  if (priority !== undefined && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
    updates.push(`priority = $${i++}`)
    vals.push(priority)
  }
  if (assigned_to !== undefined) {
    updates.push(`assigned_to = $${i++}`)
    vals.push(assigned_to || null)
  }
  if (status !== undefined && ['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    updates.push(`status = $${i++}`)
    vals.push(status)
    if (status === 'completed') {
      updates.push(`completed_at = NOW()`, `completed_by = $${i++}`)
      vals.push(admin.adminId)
    } else if (current.status === 'completed') {
      updates.push(`completed_at = NULL`, `completed_by = NULL`)
    }
  }

  vals.push(taskId, id)
  await query(`UPDATE customer_tasks SET ${updates.join(', ')} WHERE id = $${i++} AND user_id = $${i++}`, vals)

  if (status === 'completed' && current.status !== 'completed') {
    logActivity({
      userId: id,
      actorId: admin.adminId,
      kind: 'task_completed',
      referenceId: taskId,
      referenceType: 'customer_tasks',
      summary: `Task completed: ${current.title}`,
    }).catch(() => {})
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  await query(`DELETE FROM customer_tasks WHERE id = $1 AND user_id = $2`, [taskId, id])
  return NextResponse.json({ success: true })
}
