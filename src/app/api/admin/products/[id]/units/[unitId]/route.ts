import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string; unitId: string } }

async function ensureProductUnit(productId: string, unitId: string) {
  const row = await queryOne<{ id: string; is_base: boolean }>(
    `SELECT id, is_base FROM product_units WHERE id = $1 AND product_id = $2 AND variant_id IS NULL`,
    [unitId, productId]
  )
  return row
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const existing = await ensureProductUnit(params.id, params.unitId)
  if (!existing) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const updates: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (body.unit !== undefined) {
    const u = String(body.unit).trim()
    if (!u) return NextResponse.json({ error: 'unit cannot be empty' }, { status: 400 })
    updates.push(`unit = $${i++}`); vals.push(u)
  }
  if (body.factor !== undefined) {
    const f = Number(body.factor)
    if (!Number.isFinite(f) || f <= 0) return NextResponse.json({ error: 'factor must be positive' }, { status: 400 })
    updates.push(`factor = $${i++}`); vals.push(f)
  }
  if (body.display_label !== undefined) {
    updates.push(`display_label = $${i++}`)
    vals.push(body.display_label ? String(body.display_label).slice(0, 80) : null)
  }
  if (body.notes !== undefined) {
    updates.push(`notes = $${i++}`)
    vals.push(body.notes ? String(body.notes).slice(0, 500) : null)
  }
  if (body.dimension !== undefined) {
    const allowed = ['count', 'length', 'area', 'volume', 'weight', 'custom']
    if (!allowed.includes(body.dimension)) return NextResponse.json({ error: `bad dimension` }, { status: 400 })
    updates.push(`dimension = $${i++}`); vals.push(body.dimension)
  }
  if (body.conversion_meta !== undefined) {
    if (body.conversion_meta === null) updates.push(`conversion_meta = NULL`)
    else { updates.push(`conversion_meta = $${i++}`); vals.push(JSON.stringify(body.conversion_meta)) }
  }

  const setBase = body.is_base === true
  const setSell = body.is_sell_default === true
  const setPurchase = body.is_purchase_default === true

  try {
    const updated = await withTransaction(async (client) => {
      if (setBase) {
        await client.query(`UPDATE product_units SET is_base = FALSE WHERE product_id = $1 AND variant_id IS NULL`, [params.id])
        updates.push(`is_base = TRUE`)
      }
      if (setSell) {
        await client.query(`UPDATE product_units SET is_sell_default = FALSE WHERE product_id = $1 AND variant_id IS NULL`, [params.id])
        updates.push(`is_sell_default = TRUE`)
      }
      if (setPurchase) {
        await client.query(`UPDATE product_units SET is_purchase_default = FALSE WHERE product_id = $1 AND variant_id IS NULL`, [params.id])
        updates.push(`is_purchase_default = TRUE`)
      }
      if (updates.length === 0) {
        const cur = await client.query(`SELECT * FROM product_units WHERE id = $1`, [params.unitId])
        return cur.rows[0]
      }
      updates.push(`updated_at = NOW()`)
      vals.push(params.unitId)
      const res = await client.query(
        `UPDATE product_units SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
      )
      return res.rows[0]
    })
    return NextResponse.json({ unit: updated })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'A unit with this name already exists for this product' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const existing = await ensureProductUnit(params.id, params.unitId)
  if (!existing) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  if (existing.is_base) {
    return NextResponse.json({ error: 'Cannot delete the base unit. Make another unit the base first.' }, { status: 400 })
  }
  await query(`DELETE FROM product_units WHERE id = $1`, [params.unitId])
  return NextResponse.json({ ok: true })
}
