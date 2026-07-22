import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'
interface Params { params: Promise<{ id: string }> }

// POST — create a draft for this category
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const category = await queryOne<{ id: string }>(
    `SELECT id FROM categories WHERE id = $1`, [id]
  )
  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const existing = await queryOne<{ category_id: string }>(
    `SELECT category_id FROM category_drafts WHERE category_id = $1`, [id]
  )
  if (existing) {
    return NextResponse.json({ error: 'Draft already exists', categoryId: id }, { status: 409 })
  }

  await query(
    `INSERT INTO category_drafts (category_id, fields)
     SELECT id, to_jsonb(c) - 'id' - 'created_at' - 'updated_at' - 'search_vector'
     FROM categories c WHERE c.id = $1`,
    [id]
  )
  return NextResponse.json({ success: true, categoryId: id })
}

// PATCH — autosave fields to draft
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json()
  const fields = body?.fields
  if (!fields || typeof fields !== 'object') {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  await query(
    `INSERT INTO category_drafts (category_id, fields, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (category_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
    [id, JSON.stringify(fields)]
  )
  return NextResponse.json({ success: true })
}

// DELETE — discard draft
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  await query(`DELETE FROM category_drafts WHERE category_id = $1`, [id])
  return NextResponse.json({ success: true })
}
