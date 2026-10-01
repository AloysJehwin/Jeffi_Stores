import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(_req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const tags = await queryMany(
    `SELECT id, tag, created_at FROM customer_tags WHERE user_id = $1 ORDER BY created_at DESC`,
    [id]
  )
  return NextResponse.json({ tags })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tag } = await req.json()
  const trimmed = String(tag || '')
    .trim()
    .toLowerCase()
    .slice(0, 60)
  if (!trimmed) return NextResponse.json({ error: 'Tag is required' }, { status: 400 })

  await query(
    `INSERT INTO customer_tags (user_id, tag, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, tag) DO NOTHING`,
    [id, trimmed, admin.adminId]
  )
  await logActivity({
    userId: id,
    actorId: admin.adminId,
    kind: 'tag_added',
    summary: `Tag "${trimmed}" added`,
    metadata: { tag: trimmed },
  })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const tag = req.nextUrl.searchParams.get('tag')
  if (!tag) return NextResponse.json({ error: 'tag query param required' }, { status: 400 })

  await query(`DELETE FROM customer_tags WHERE user_id = $1 AND tag = $2`, [id, tag.toLowerCase()])
  await logActivity({
    userId: id,
    actorId: admin.adminId,
    kind: 'tag_removed',
    summary: `Tag "${tag.toLowerCase()}" removed`,
    metadata: { tag: tag.toLowerCase() },
  })
  return NextResponse.json({ success: true })
}
