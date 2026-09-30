import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const draft = await queryOne<any>(
      `SELECT * FROM orders WHERE id = $1 AND status = 'draft' AND draft_of_id IS NOT NULL`,
      [id]
    )
    if (!draft) return NextResponse.json({ error: 'Amendment draft not found' }, { status: 404 })

    const original = await queryOne<any>(`SELECT * FROM orders WHERE id = $1`, [draft.draft_of_id])
    if (!original) return NextResponse.json({ error: 'Original invoice not found' }, { status: 404 })

    const originalId = original.id

    await withTransaction(async client => {
      await client.query(
        `UPDATE orders SET
          total_amount          = $1,
          subtotal              = $2,
          tax_amount            = $3,
          discount_amount       = $4,
          taxable_amount        = $5,
          cgst_amount           = $6,
          sgst_amount           = $7,
          igst_amount           = $8,
          notes                 = $9,
          updated_at            = NOW()
        WHERE id = $10`,
        [
          draft.total_amount,
          draft.subtotal,
          draft.tax_amount,
          draft.discount_amount,
          draft.taxable_amount,
          draft.cgst_amount,
          draft.sgst_amount,
          draft.igst_amount,
          draft.notes,
          originalId,
        ]
      )

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [originalId])

      await client.query(
        `INSERT INTO order_items (
          order_id, product_id, variant_id, sub_variant_id,
          product_name, product_sku, variant_name, sub_variant_name,
          quantity, unit_price, mrp,
          discount_amount, tax_amount, total_price,
          hsn_code, gst_rate,
          taxable_amount, cgst_amount, sgst_amount, igst_amount,
          buy_mode, buy_unit, sold_unit, sold_unit_factor, base_quantity,
          applied_rules
        )
        SELECT
          $1, product_id, variant_id, sub_variant_id,
          product_name, product_sku, variant_name, sub_variant_name,
          quantity, unit_price, mrp,
          discount_amount, tax_amount, total_price,
          hsn_code, gst_rate,
          taxable_amount, cgst_amount, sgst_amount, igst_amount,
          buy_mode, buy_unit, sold_unit, sold_unit_factor, base_quantity,
          applied_rules
        FROM order_items
        WHERE order_id = $2`,
        [originalId, id]
      )

      await client.query(`DELETE FROM orders WHERE id = $1`, [id])
    })

    return NextResponse.json({ success: true, orderId: originalId })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
