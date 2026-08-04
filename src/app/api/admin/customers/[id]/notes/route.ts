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

  const notes = await queryMany(`
    SELECT n.id, n.body, n.created_at,
           COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS admin_username, u.first_name AS admin_first_name, u.last_name AS admin_last_name
    FROM customer_notes n
    LEFT JOIN admins a ON n.admin_id = a.id
    LEFT JOIN users u ON a.user_id = u.id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    LIMIT 100
  `, [id])
  return NextResponse.json({ notes })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { body } = await req.json()
  const trimmed = String(body || '').trim()
  if (!trimmed) return NextResponse.json({ error: 'Note body is required' }, { status: 400 })
  if (trimmed.length > 2000) return NextResponse.json({ error: 'Note too long (max 2000 chars)' }, { status: 400 })

  await query(
    `INSERT INTO customer_notes (user_id, body, admin_id) VALUES ($1, $2, $3)`,
    [id, trimmed, admin.adminId]
  )
  await logActivity({
    userId: id,
    actorId: admin.adminId,
    kind: 'note_added',
    summary: trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed,
  })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const noteId = req.nextUrl.searchParams.get('noteId')
  if (!noteId) return NextResponse.json({ error: 'noteId query param required' }, { status: 400 })

  await query(`DELETE FROM customer_notes WHERE id = $1 AND user_id = $2`, [noteId, id])
  return NextResponse.json({ success: true })
}
