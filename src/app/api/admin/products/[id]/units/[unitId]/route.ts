import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction, query } from '@/lib/db'
import { assertUnitChangeAllowed, validateSerializedUnitStep, changedUnitFields, validateUnitQuantityBounds } from '@/lib/selling-unit'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; unitId: string }> }

async function ensureProductUnit(productId: string, unitId: string) {
  const row = await queryOne<{ id: string; unit: string; is_base: boolean; factor: string; dimension: string; qty_step: string; min_qty: string; max_qty: string | null }>(
    `SELECT id, unit, is_base, factor::text, dimension, qty_step::text, min_qty::text, max_qty::text
       FROM product_units WHERE id = $1 AND product_id = $2 AND variant_id IS NULL AND sub_variant_id IS NULL`,
    [unitId, productId]
  )
  return row
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, unitId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const existing = await ensureProductUnit(id, unitId)
  if (!existing) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Batches and serials carry no unit reference — the live unit row is what gives
  // their bare numbers meaning. Refuse edits that would reinterpret existing stock.
  const guardErr = await assertUnitChangeAllowed(
    { query },
    { productId: id, label: existing.unit },
    changedUnitFields(body, existing)
  )
  if (guardErr) return NextResponse.json({ error: guardErr }, { status: 409 })

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
    const serialRow = await queryOne<{ serialized: boolean }>(`SELECT serialized FROM products WHERE id = $1`, [id])
    if (serialRow?.serialized) {
      const stepErr = validateSerializedUnitStep(v)
      if (stepErr) return NextResponse.json({ error: stepErr }, { status: 400 })
    }
    updates.push(`qty_step = $${i++}`); vals.push(v)
  }


  // Validate the MERGED result: a PATCH that moves only one of the three can
  // still leave min/max off the qty_step grid.
  {
    const mergedStep = body.qty_step !== undefined ? Number(body.qty_step) : parseFloat(existing.qty_step ?? '')
    const mergedMin = body.min_qty !== undefined ? Number(body.min_qty) : parseFloat(existing.min_qty ?? '')
    const mergedMax = body.max_qty !== undefined
      ? (body.max_qty === null ? null : Number(body.max_qty))
      : (existing.max_qty == null ? null : parseFloat(existing.max_qty))
    if (Number.isFinite(mergedStep) && Number.isFinite(mergedMin)) {
      const boundsErr = validateUnitQuantityBounds({ qty_step: mergedStep, min_qty: mergedMin, max_qty: mergedMax })
      if (boundsErr) return NextResponse.json({ error: boundsErr }, { status: 400 })
    }
  }

  const setBase = body.is_base === true

  try {
    const updated = await withTransaction(async (client) => {
      if (setBase) {
        await client.query(`UPDATE product_units SET is_base = FALSE WHERE product_id = $1 AND variant_id IS NULL`, [id])
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
      return NextResponse.json({ error: 'A unit with this name already exists for this product' }, { status: 409 })
    }
    return NextResponse.json({ error: msg || 'Failed to update unit' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, unitId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const existing = await ensureProductUnit(id, unitId)
  if (!existing) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  if (existing.is_base) {
    return NextResponse.json({ error: 'Cannot delete the base unit. Make another unit the base first.' }, { status: 400 })
  }
  const guardErr = await assertUnitChangeAllowed(
    { query },
    { productId: id, label: existing.unit },
    { remove: true }
  )
  if (guardErr) return NextResponse.json({ error: guardErr }, { status: 409 })
  await query(`DELETE FROM product_units WHERE id = $1`, [unitId])
  return NextResponse.json({ ok: true })
}
