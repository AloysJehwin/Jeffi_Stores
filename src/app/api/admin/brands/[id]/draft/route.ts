import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'
interface Params { params: Promise<{ id: string }> }

// POST — create a draft from the live brand (regardless of is_active).
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'brands:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const brand = await queryOne<{ id: string }>(`SELECT id FROM brands WHERE id = $1`, [id])
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const existing = await queryOne<{ brand_id: string }>(
    `SELECT brand_id FROM brand_drafts WHERE brand_id = $1`, [id]
  )
  if (existing) {
    return NextResponse.json({ error: 'A draft already exists for this brand', brandId: id }, { status: 409 })
  }

  await query(
    `INSERT INTO brand_drafts (brand_id, fields)
     SELECT id, to_jsonb(b) - 'id' - 'created_at' - 'updated_at'
     FROM brands b WHERE b.id = $1
     ON CONFLICT (brand_id) DO NOTHING`,
    [id]
  )
  return NextResponse.json({ success: true, brandId: id })
}

// DELETE — discard draft
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'brands:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  await query(`DELETE FROM brand_drafts WHERE brand_id = $1`, [id])
  return NextResponse.json({ success: true })
}
