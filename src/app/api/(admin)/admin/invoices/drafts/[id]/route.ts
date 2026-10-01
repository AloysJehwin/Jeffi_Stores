import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { isInterState, calculateGST, round2 } from '@/lib/catalog/gst'
import { lineItemFromMrpIncl } from '@/lib/catalog/pricing'

export const dynamic = 'force-dynamic'

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

    const body = await request.json()
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
    } = body

    if (!customerName) {
      return NextResponse.json({ error: 'customerName is required' }, { status: 400 })
    }

    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '33'
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    const processedItems = (items || []).map((item: any) => {
      const unitPrice = parseFloat(item.unit_price) || 0
      const qty = parseFloat(item.quantity) || 0
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')
      const lineTotal = round2(lineItemFromMrpIncl(qty, unitPrice, discPct, gstRate))
      const gst = calculateGST(lineTotal, gstRate, orderIsIgst)

      subtotal += lineTotal
      totalTaxable += gst.taxableAmount
      totalCgst += gst.cgst
      totalSgst += gst.sgst
      totalIgst += gst.igst

      return {
        product_id: item.product_id || null,
        product_name: item.product_name || '',
        product_sku: item.product_sku || '',
        variant_id: item.variant_id || null,
        sub_variant_id: item.sub_variant_id || null,
        variant_name: item.variant_name || null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        unit_price: unitPrice,
        mrp: unitPrice,
        total_price: lineTotal,
        taxable_amount: round2(gst.taxableAmount),
        cgst_amount: round2(gst.cgst),
        sgst_amount: round2(gst.sgst),
        igst_amount: round2(gst.igst),
        tax_amount: round2(gst.cgst + gst.sgst + gst.igst),
      }
    })

    const taxAmount = round2(totalCgst + totalSgst + totalIgst)
    const totalAmount = round2(subtotal)

    await withTransaction(async client => {
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
            hsn_code, gst_rate, quantity, unit_price, mrp, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19)`,
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
            item.unit_price,
            item.mrp,
            item.tax_amount,
            item.total_price,
            item.taxable_amount,
            item.cgst_amount,
            item.sgst_amount,
            item.igst_amount,
          ]
        )
      }
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
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
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id])
      await client.query(`DELETE FROM addresses WHERE id = (SELECT shipping_address_id FROM orders WHERE id = $1)`, [
        id,
      ])
      await client.query(`DELETE FROM orders WHERE id = $1`, [id])
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
