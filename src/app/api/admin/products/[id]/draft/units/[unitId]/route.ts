import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; unitId: string }> }

async function getDraftUnits(productId: string): Promise<any[]> {
  const row = await queryOne<{ units: any[] }>(
    `SELECT units FROM product_drafts WHERE product_id = $1`, [productId]
  )
  return Array.isArray(row?.units) ? row!.units : []
}

// PATCH — update a unit in draft.units by id
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, unitId } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const units = await getDraftUnits(id)
  const body = await req.json()
  let updated: any[]
  const idx = units.findIndex((u: any) => u.id === unitId)
  if (idx >= 0) {
    updated = units.map((u: any) => u.id === unitId ? { ...u, ...body } : u)
  } else {
    // Unit not in draft yet — add it with this id
    updated = [...units, { ...body, id: unitId }]
  }
  await query(
    `UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(updated)]
  )
  return NextResponse.json({ success: true, unit: updated.find((u: any) => u.id === unitId) })
}

// DELETE — remove a unit from draft.units by id
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, unitId } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const units = await getDraftUnits(id)
  const filtered = units.filter((u: any) => u.id !== unitId)
  await query(
    `UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(filtered)]
  )
  return NextResponse.json({ success: true })
}
