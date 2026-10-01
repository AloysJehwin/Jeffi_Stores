import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, query } from '@/lib/shared/db'
import { sendPurchaseOrderEmail } from '@/lib/email'
import { parseBody } from '@/lib/shared/validate'

const PatchSchema = z
  .object({
    status: z.string().nullish(),
    expected_date: z.string().nullish(),
    notes: z.string().nullish(),
  })
  .refine(d => d.status !== undefined || d.expected_date !== undefined || d.notes !== undefined, {
    message: 'At least one field required',
  })

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const po = await queryOne<any>(
      `SELECT po.*, s.name AS supplier_name, s.gstin AS supplier_gstin,
              s.contact_name, s.phone AS supplier_phone, s.email AS supplier_email
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1`,
      [id]
    )

    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany<any>(
      `SELECT poi.*,
              p.name AS product_name_current,
              p.perishable,
              p.serialized,
              pv.variant_name,
              COALESCE(vsu.display_label, vsu.unit, psu.display_label, psu.unit) AS sell_unit_label,
              COALESCE(vsu.dimension, psu.dimension) AS sell_unit_dimension,
              COALESCE(vsu.qty_step, psu.qty_step) AS sell_unit_qty_step
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       LEFT JOIN product_variants pv ON pv.id = poi.variant_id
       LEFT JOIN product_units vsu ON vsu.id = pv.sell_unit_id
       LEFT JOIN product_units psu ON psu.id = p.sell_unit_id
       WHERE poi.po_id = $1
       ORDER BY poi.id`,
      [id]
    )

    const grns = await queryMany<any>(
      `SELECT g.id, g.grn_number, g.received_date, g.notes, g.created_at,
              json_agg(json_build_object(
                'po_item_id', gi.po_item_id,
                'product_id', gi.product_id,
                'variant_id', gi.variant_id,
                'quantity_received', gi.quantity_received,
                'unit_cost', gi.unit_cost,
                'purchase_unit_factor', gi.purchase_unit_factor,
                'tax_rate', poi.tax_rate,
                'gst_inclusive', poi.gst_inclusive
              ) ORDER BY gi.id) AS grn_items
       FROM grns g
       JOIN grn_items gi ON gi.grn_id = g.id
       JOIN purchase_order_items poi ON poi.id = gi.po_item_id
       WHERE g.po_id = $1
       GROUP BY g.id
       ORDER BY g.received_date DESC, g.created_at DESC`,
      [id]
    )

    return NextResponse.json({ purchase_order: po, items: items || [], grns: grns || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(PatchSchema, raw)
    if (!parsed.ok) return parsed.response
    const { status, expected_date, notes } = parsed.data

    const updates: string[] = []
    const values: any[] = []
    let i = 1

    if (status !== undefined) {
      updates.push(`status = $${i++}`)
      values.push(status)
    }
    if (expected_date !== undefined) {
      updates.push(`expected_date = $${i++}`)
      values.push(expected_date || null)
    }
    if (notes !== undefined) {
      updates.push(`notes = $${i++}`)
      values.push(notes || null)
    }

    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    updates.push(`updated_at = NOW()`)
    values.push(id)

    await query(`UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = $${i}`, values)

    if (status === 'sent') {
      try {
        const po = await queryOne<any>(
          `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.id = $1`,
          [id]
        )
        const poItems = await queryMany<any>(
          `SELECT poi.quantity, poi.unit_cost,
                  COALESCE(poi.product_name, p.name) AS product_name,
                  pv.variant_name
           FROM purchase_order_items poi
           LEFT JOIN products p ON p.id = poi.product_id
           LEFT JOIN product_variants pv ON pv.id = poi.variant_id
           WHERE poi.po_id = $1`,
          [id]
        )
        if (po?.supplier_email) {
          await sendPurchaseOrderEmail(
            po.supplier_email,
            po.contact_name || '',
            po.supplier_name,
            po.po_number,
            parseFloat(po.total_amount),
            (poItems || []).map((it: any) => ({
              product_name: it.product_name,
              variant_name: it.variant_name,
              quantity: parseFloat(it.quantity),
              unit_cost: parseFloat(it.unit_cost),
            }))
          )
        }
      } catch (_) {}
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
