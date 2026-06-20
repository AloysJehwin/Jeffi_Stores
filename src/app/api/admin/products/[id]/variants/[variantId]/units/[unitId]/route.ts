import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string; variantId: string; unitId: string }>
}

async function ensureVariant(productId: string, variantId: string) {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
    [variantId, productId]
  )
  return !!row
}

async function ensureUnitOwnership(unitId: string, variantId: string) {
  const row = await queryOne<{ id: string; is_base: boolean }>(
    `SELECT id, is_base FROM product_units WHERE id = $1 AND variant_id = $2`,
    [unitId, variantId]
  )
  return row
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, variantId, unitId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  if (!(await ensureVariant(id, variantId))) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
  }
  const existing = await ensureUnitOwnership(unitId, variantId)
  if (!existing) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const updates: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (body.unit !== undefined) {
    const u = String(body.unit).trim()
    if (!u) return NextResponse.json({ error: 'unit cannot be empty' }, { status: 400 })
    updates.push(`unit = $${i++}`)
    vals.push(u)
  }
  if (body.factor !== undefined) {
    const f = Number(body.factor)
    if (!Number.isFinite(f) || f <= 0) {
      return NextResponse.json({ error: 'factor must be a positive number' }, { status: 400 })
    }
    updates.push(`factor = $${i++}`)
    vals.push(f)
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
    if (!allowed.includes(body.dimension)) {
      return NextResponse.json({ error: `dimension must be one of ${allowed.join(', ')}` }, { status: 400 })
    }
    updates.push(`dimension = $${i++}`)
    vals.push(body.dimension)
  }
  if (body.conversion_meta !== undefined) {
    if (body.conversion_meta === null) {
      updates.push(`conversion_meta = NULL`)
    } else {
      updates.push(`conversion_meta = $${i++}`)
      vals.push(JSON.stringify(body.conversion_meta))
    }
  }
  if (body.min_qty !== undefined) {
    const v = Number(body.min_qty)
    if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: 'min_qty must be positive' }, { status: 400 })
    updates.push(`min_qty = $${i++}`); vals.push(v)
  }
  if (body.max_qty !== undefined) {
    if (body.max_qty === null) updates.push(`max_qty = NULL`)
    else {
      const v = Number(body.max_qty)
      if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: 'max_qty must be positive' }, { status: 400 })
      updates.push(`max_qty = $${i++}`); vals.push(v)
    }
  }
  if (body.qty_step !== undefined) {
    const v = Number(body.qty_step)
    if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: 'qty_step must be positive' }, { status: 400 })
    updates.push(`qty_step = $${i++}`); vals.push(v)
  }

  const setBase = body.is_base === true

  try {
    const updated = await withTransaction(async (client) => {
      if (setBase) {
        await client.query(`UPDATE product_units SET is_base = FALSE WHERE variant_id = $1`, [variantId])
        updates.push(`is_base = TRUE`)
      }
      if (updates.length === 0) {
        const cur = await client.query(`SELECT * FROM product_units WHERE id = $1`, [unitId])
        return cur.rows[0]
      }
      updates.push(`updated_at = NOW()`)
      vals.push(unitId)
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
      return NextResponse.json({ error: 'A unit with this name already exists for this variant' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, variantId, unitId } = await params
  const admin = await authenticateAdmin(_request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  if (!(await ensureVariant(id, variantId))) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
  }
  const existing = await ensureUnitOwnership(unitId, variantId)
  if (!existing) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  // For the base unit, only allow deletion when it's the sole variant unit —
  // deleting it falls back to inheriting the product-level unit.
  if (existing.is_base) {
    const sibling = await queryOne<{ id: string }>(
      `SELECT id FROM product_units WHERE variant_id = $1 AND id <> $2 LIMIT 1`,
      [variantId, unitId]
    )
    if (sibling) {
      return NextResponse.json({ error: 'Cannot delete the base unit. Make another unit the base first.' }, { status: 400 })
    }
  }

  await queryOne(`DELETE FROM product_units WHERE id = $1`, [unitId])
  return NextResponse.json({ ok: true })
}
