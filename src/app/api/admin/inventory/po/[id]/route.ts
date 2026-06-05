import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query } from '@/lib/db'
import { sendPurchaseOrderEmail } from '@/lib/email'
import { parseBody } from '@/lib/validate'

const PatchSchema = z.object({
  status: z.string().nullish(),
  expected_date: z.string().nullish(),
  notes: z.string().nullish(),
}).refine(
  (d) => d.status !== undefined || d.expected_date !== undefined || d.notes !== undefined,
  { message: 'At least one field required' }
)

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const po = await queryOne<any>(
      `SELECT po.*, s.name AS supplier_name, s.gstin AS supplier_gstin,
              s.contact_name, s.phone AS supplier_phone, s.email AS supplier_email
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1`,
      [params.id]
    )

    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany<any>(
      `SELECT poi.*,
              p.name AS product_name_current,
              pv.variant_name
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       LEFT JOIN product_variants pv ON pv.id = poi.variant_id
       WHERE poi.po_id = $1
       ORDER BY poi.id`,
      [params.id]
    )

    return NextResponse.json({ purchase_order: po, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(PatchSchema, raw)
    if (!parsed.ok) return parsed.response
    const { status, expected_date, notes } = parsed.data

    const updates: string[] = []
    const values: any[] = []
    let i = 1

    if (status !== undefined) { updates.push(`status = $${i++}`); values.push(status) }
    if (expected_date !== undefined) { updates.push(`expected_date = $${i++}`); values.push(expected_date || null) }
    if (notes !== undefined) { updates.push(`notes = $${i++}`); values.push(notes || null) }

    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    updates.push(`updated_at = NOW()`)
    values.push(params.id)

    await query(`UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = $${i}`, values)

    if (status === 'sent') {
      try {
        const po = await queryOne<any>(
          `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.id = $1`,
          [params.id]
        )
        const poItems = await queryMany<any>(
          `SELECT poi.quantity, poi.unit_cost,
                  COALESCE(poi.product_name, p.name) AS product_name,
                  pv.variant_name
           FROM purchase_order_items poi
           LEFT JOIN products p ON p.id = poi.product_id
           LEFT JOIN product_variants pv ON pv.id = poi.variant_id
           WHERE poi.po_id = $1`,
          [params.id]
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
