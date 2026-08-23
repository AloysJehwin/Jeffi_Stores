import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const defs = await queryMany(
    `SELECT id, tag, color, sort_order FROM customer_tag_definitions ORDER BY sort_order ASC, tag ASC`
  )
  return NextResponse.json({ definitions: defs || [] })
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tag, color } = await req.json()
  const trimmed = String(tag || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60)
  if (!trimmed) return NextResponse.json({ error: 'Tag is required' }, { status: 400 })
  const safeColor = String(color || 'accent').trim().slice(0, 20)

  const maxOrder = await queryMany<{ sort_order: number }>(
    `SELECT sort_order FROM customer_tag_definitions ORDER BY sort_order DESC LIMIT 1`
  )
  const nextOrder = ((maxOrder?.[0]?.sort_order ?? 0) + 10)

  try {
    await query(
      `INSERT INTO customer_tag_definitions (tag, color, sort_order, created_by) VALUES ($1, $2, $3, $4)`,
      [trimmed, safeColor, nextOrder, admin.adminId]
    )
  } catch (e: any) {
    if (e.code === '23505') return NextResponse.json({ error: 'Tag already exists' }, { status: 409 })
    throw e
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await query(`DELETE FROM customer_tag_definitions WHERE id = $1`, [id])
  return NextResponse.json({ success: true })
}
