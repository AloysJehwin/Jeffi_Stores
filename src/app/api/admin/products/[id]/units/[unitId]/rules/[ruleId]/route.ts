import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; unitId: string; ruleId: string }> }

async function ensureRule(productId: string, unitId: string, ruleId: string) {
  const row = await queryOne<{ id: string }>(
    `SELECT r.id FROM product_unit_rules r
     JOIN product_units pu ON pu.id = r.product_unit_id
     WHERE r.id = $1 AND pu.id = $2 AND pu.product_id = $3 AND pu.variant_id IS NULL`,
    [ruleId, unitId, productId]
  )
  return !!row
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, unitId, ruleId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureRule(id, unitId, ruleId))) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const updates: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (body.config !== undefined) { updates.push(`config = $${i++}`); vals.push(JSON.stringify(body.config)) }
  if (body.is_active !== undefined) { updates.push(`is_active = $${i++}`); vals.push(!!body.is_active) }
  if (body.priority !== undefined) { updates.push(`priority = $${i++}`); vals.push(Number(body.priority)) }
  if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  vals.push(ruleId)
  const updated = await queryOne(
    `UPDATE product_unit_rules SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  )
  return NextResponse.json({ rule: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, unitId, ruleId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureRule(id, unitId, ruleId))) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }
  await query(`DELETE FROM product_unit_rules WHERE id = $1`, [ruleId])
  return NextResponse.json({ ok: true })
}
