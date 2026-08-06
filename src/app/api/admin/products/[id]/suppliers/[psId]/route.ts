import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; psId: string }> }

// Edit a product-supplier row. If the price changes we INSERT a new dated row
// (preserving quote history) and deactivate the old one; metadata-only changes
// update in place. Toggling is_preferred clears the flag on siblings.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, psId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await queryOne<any>(
    `SELECT * FROM product_suppliers WHERE id = $1 AND product_id = $2 AND is_active = true`,
    [psId, id]
  )
  if (!existing) return NextResponse.json({ error: 'Supplier link not found' }, { status: 404 })

  const newCost = body.unit_cost != null ? Number(body.unit_cost) : Number(existing.unit_cost)
  if (!Number.isFinite(newCost) || newCost < 0) {
    return NextResponse.json({ error: 'unit_cost must be a non-negative number' }, { status: 400 })
  }
  const isPreferred = body.is_preferred != null ? !!body.is_preferred : existing.is_preferred
  const currency = body.currency != null ? String(body.currency).slice(0, 3) : existing.currency
  const gstInclusive = body.gst_inclusive != null ? !!body.gst_inclusive : existing.gst_inclusive
  const moq = body.moq !== undefined ? (Number.isFinite(Number(body.moq)) ? Number(body.moq) : null) : existing.moq
  const leadTime = body.lead_time_days !== undefined ? (Number.isInteger(Number(body.lead_time_days)) ? Number(body.lead_time_days) : null) : existing.lead_time_days
  const notes = body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 500) : null) : existing.notes
  const priceChanged = Number(existing.unit_cost) !== newCost

  try {
    const result = await withTransaction(async (client) => {
      if (isPreferred) {
        // Clear preferred on other rows AT THE SAME LEAF as this row.
        await client.query(
          `UPDATE product_suppliers SET is_preferred = false, updated_at = NOW()
           WHERE product_id = $1 AND is_preferred = true AND id <> $2
             AND variant_id IS NOT DISTINCT FROM $3::uuid
             AND sub_variant_id IS NOT DISTINCT FROM $4::uuid`,
          [id, psId, existing.variant_id, existing.sub_variant_id]
        )
      }
      if (priceChanged) {
        // Preserve history: deactivate old, insert a new dated row for the same supplier+leaf.
        await client.query(
          `UPDATE product_suppliers SET is_active = false, is_preferred = false, updated_at = NOW() WHERE id = $1`,
          [psId]
        )
        const res = await client.query(
          `INSERT INTO product_suppliers
             (product_id, variant_id, sub_variant_id, supplier_id, unit_cost, currency, gst_inclusive, moq, lead_time_days, is_preferred, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [id, existing.variant_id, existing.sub_variant_id, existing.supplier_id, newCost, currency, gstInclusive, moq, leadTime, isPreferred, notes]
        )
        return { id: res.rows[0].id, newRow: true }
      }
      await client.query(
        `UPDATE product_suppliers
           SET currency = $1, gst_inclusive = $2, moq = $3, lead_time_days = $4,
               is_preferred = $5, notes = $6, updated_at = NOW()
         WHERE id = $7`,
        [currency, gstInclusive, moq, leadTime, isPreferred, notes, psId]
      )
      return { id: psId, newRow: false }
    })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update supplier' }, { status: 500 })
  }
}

// Soft-delete a product-supplier row (keeps the quote trail).
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, psId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const res = await queryOne<{ id: string }>(
    `UPDATE product_suppliers SET is_active = false, is_preferred = false, updated_at = NOW()
     WHERE id = $1 AND product_id = $2 AND is_active = true
     RETURNING id`,
    [psId, id]
  )
  if (!res) return NextResponse.json({ error: 'Supplier link not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
