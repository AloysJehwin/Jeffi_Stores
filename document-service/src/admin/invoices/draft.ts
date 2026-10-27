import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne, queryMany, withTransaction } from '@jeffi/tenancy'
import { isInterState, round2 } from '../../lib/gst'
import { getBusinessValues, getFeatureFlags } from '../../lib/site-controls'
import { parseBody } from '../../lib/validate'
import { draftInvoiceSchema, priceInvoiceLines } from '../../lib/invoice-line-items'
import { canDiscard, closeLock, draftLockResponse, epochFrom, withDraftWrite } from '../../lib/draft-locks'


export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT o.*, a.address_line1, a.address_line2, a.city, a.state, a.postal_code
       FROM orders o
       LEFT JOIN addresses a ON a.id = o.shipping_address_id
       WHERE o.id = $1 AND o.status = 'draft'`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

    const items = await queryMany<any>(
      `
      SELECT oi.*,
        COALESCE(sv.inventory_quantity, pv.inventory_quantity, p.inventory_quantity) AS inventory_quantity
      FROM order_items oi
      LEFT JOIN product_sub_variants sv ON sv.id = oi.sub_variant_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p ON p.id = oi.product_id AND oi.variant_id IS NULL AND oi.sub_variant_id IS NULL
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC
    `,
      [id]
    )

    return NextResponse.json({ order, items })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(`SELECT id, status FROM orders WHERE id = $1`, [id])
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (order.status !== 'draft')
      return NextResponse.json({ error: 'Only drafts can be updated this way' }, { status: 400 })

    const parsed = parseBody(draftInvoiceSchema, await request.json(), `PATCH /api/admin/invoices/drafts/${id}`)
    if (!parsed.ok) return parsed.response
    const {
      customerName,
      customerPhone,
      customerEmail,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      buyerGstin,
      paymentMode,
      notes,
      items,
    } = parsed.data

    const sellerStateCode = (await getBusinessValues()).businessStateCode
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false
    const { gstEnabled } = await getFeatureFlags()
    // Same pricing as create: keeps the selling unit / factor / discount on save.
    const priced = priceInvoiceLines(items, { gstEnabled, orderIsIgst })
    const processedItems = priced.lines
    const { subtotal, taxAmount, totalAmount, totalTaxable, totalCgst, totalSgst, totalIgst } = priced

    await withDraftWrite(admin, 'invoice', id, async client => {
      await client.query(
        `UPDATE orders SET
          customer_name = $1, customer_phone = $2, customer_email = $3,
          buyer_gstin = $4, is_igst = $5,
          subtotal = $6, tax_amount = $7, taxable_amount = $8,
          cgst_amount = $9, sgst_amount = $10, igst_amount = $11,
          total_amount = $12, payment_status = $13, notes = $14,
          updated_at = NOW()
        WHERE id = $15`,
        [
          customerName,
          customerPhone || null,
          customerEmail || null,
          buyerGstin || null,
          orderIsIgst,
          subtotal,
          taxAmount,
          round2(totalTaxable),
          round2(totalCgst),
          round2(totalSgst),
          round2(totalIgst),
          totalAmount,
          paymentMode === 'credit' ? 'unpaid' : 'paid',
          notes || null,
          id,
        ]
      )

      await client.query(
        `UPDATE addresses SET
          full_name = $1, address_line1 = $2, address_line2 = $3,
          city = $4, state = $5, postal_code = $6
        WHERE id = (SELECT shipping_address_id FROM orders WHERE id = $7)`,
        [customerName, addressLine1 || '', addressLine2 || null, city || '', state || '', postalCode || '', id]
      )

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id])

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name, sub_variant_name,
            hsn_code, gst_rate, quantity, buy_unit, sold_unit, sold_unit_factor, base_quantity,
            unit_price, mrp, discount_pct, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
          [
            id,
            item.product_id,
            item.product_name,
            item.product_sku,
            item.variant_id,
            item.sub_variant_id,
            item.variant_name,
            item.sub_variant_name ?? null,
            item.hsn_code,
            item.gst_rate,
            item.quantity,
            item.buy_unit,
            item.sold_unit,
            item.sold_unit_factor,
            item.base_quantity,
            item.unit_price,
            item.mrp,
            item.discount_pct,
            item.discount_amount,
            item.tax_amount,
            item.total_price,
            item.taxable_amount,
            item.cgst_amount,
            item.sgst_amount,
            item.igst_amount,
          ]
        )
      }
    }, { epoch: epochFrom(request) })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    console.error(`[admin/invoices/drafts/${(await params).id} PATCH] failed`, err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(`SELECT id, status FROM orders WHERE id = $1`, [id])
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (order.status !== 'draft') return NextResponse.json({ error: 'Only drafts can be deleted' }, { status: 400 })

    await withTransaction(async client => {
      const addr = await client.query(`SELECT shipping_address_id, billing_address_id FROM orders WHERE id = $1`, [id])
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id])
      await client.query(`DELETE FROM orders WHERE id = $1`, [id])
      const ids = [addr.rows[0]?.shipping_address_id, addr.rows[0]?.billing_address_id].filter(Boolean)
      if (ids.length)
        await client.query(
          `DELETE FROM addresses a WHERE a.id = ANY($1::uuid[]) AND a.user_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shipping_address_id = a.id OR o.billing_address_id = a.id)`,
          [ids]
        )
      const denied = await canDiscard(admin, 'invoice', id, client)
      if (denied) throw denied
      await closeLock(client, admin, 'invoice', id, 'discarded')
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
