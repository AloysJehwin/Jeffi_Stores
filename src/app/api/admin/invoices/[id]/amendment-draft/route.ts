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
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const original = await queryOne<any>(
      `SELECT * FROM orders WHERE id = $1 AND status NOT IN ('draft', 'cancelled')`,
      [id]
    )
    if (!original) return NextResponse.json({ error: 'Invoice not found or not eligible for amendment' }, { status: 404 })

    if (!original.invoice_number) {
      return NextResponse.json({ error: 'Invoice must be finalized (invoice_number required) before creating an amendment draft' }, { status: 400 })
    }

    const existingDraft = await queryOne<any>(
      `SELECT id FROM orders WHERE draft_of_id = $1`,
      [id]
    )
    if (existingDraft) {
      return NextResponse.json({ error: 'An amendment draft already exists for this invoice', draftId: existingDraft.id }, { status: 409 })
    }

    const result = await withTransaction(async (client) => {
      const ts = Date.now()
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
      const orderNumber = `AMD-${ts}-${rand}`

      const draftResult = await client.query(
        `INSERT INTO orders (
          order_number, user_id, customer_email, customer_phone, customer_name,
          status, payment_status,
          subtotal, discount_amount, tax_amount, shipping_amount, total_amount,
          shipping_address_id, billing_address_id, shipping_method,
          notes, admin_notes,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
          buyer_gstin,
          source, order_type, payment_mode,
          needs_delivery, business_discount_amount,
          shipping_address_snapshot, billing_address_snapshot,
          invoice_number, invoice_date,
          draft_of_id,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          'draft', $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14,
          $15, $16,
          $17, $18, $19, $20, $21,
          $22,
          $23, $24, $25,
          $26, $27,
          $28, $29,
          NULL, NULL,
          $30,
          NOW(), NOW()
        ) RETURNING id, order_number`,
        [
          orderNumber,
          original.user_id,
          original.customer_email,
          original.customer_phone,
          original.customer_name,
          original.payment_status,
          original.subtotal,
          original.discount_amount,
          original.tax_amount,
          original.shipping_amount,
          original.total_amount,
          original.shipping_address_id,
          original.billing_address_id,
          original.shipping_method,
          original.notes,
          original.admin_notes,
          original.taxable_amount,
          original.cgst_amount,
          original.sgst_amount,
          original.igst_amount,
          original.is_igst,
          original.buyer_gstin,
          original.source,
          original.order_type,
          original.payment_mode,
          original.needs_delivery,
          original.business_discount_amount,
          original.shipping_address_snapshot,
          original.billing_address_snapshot,
          id,
        ]
      )

      const draftId = draftResult.rows[0].id
      const draftOrderNumber = draftResult.rows[0].order_number

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
        [draftId, id]
      )

      return { draftId, orderNumber: draftOrderNumber }
    })

    return NextResponse.json({ draftId: result.draftId, orderNumber: result.orderNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
