import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, withTransaction, queryOne } from '@/lib/db'
import { isInterState, calculateGST } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

type UnitRow = { unit: string; dimension: string; min_qty: string; max_qty: string | null; qty_step: string }

async function validateLineItemQty(
  productId: string | null | undefined,
  variantId: string | null | undefined,
  qty: number
): Promise<string | null> {
  if (!productId && !variantId) return null
  let unit: UnitRow | null = null
  if (variantId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE variant_id = $1 AND is_sell_default = TRUE LIMIT 1`,
      [variantId]
    ) ?? null
  }
  if (!unit && productId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE product_id = $1 AND variant_id IS NULL AND is_sell_default = TRUE LIMIT 1`,
      [productId]
    ) ?? null
  }
  if (!unit) return null
  const min = Number(unit.min_qty ?? 1)
  const max = unit.max_qty != null ? Number(unit.max_qty) : null
  const step = Number(unit.qty_step ?? 1)
  if (qty < min) return `Quantity must be at least ${min} ${unit.unit}`
  if (max !== null && qty > max) return `Quantity cannot exceed ${max} ${unit.unit}`
  if (unit.dimension !== 'count' && step > 0) {
    const steps = Math.round((qty - min) / step)
    const snapped = Math.round((min + steps * step) * 1e6) / 1e6
    if (Math.abs(snapped - qty) > 1e-9) return `Quantity must be in steps of ${step} from ${min}`
  }
  return null
}

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    // For each draft, count how many of its line items are short on stock.
    // A line is "short" when the chosen sub_variant / variant / product has
    // less inventory than the requested qty. Each line-item is checked at the
    // most specific level it targets (sub_variant > variant > product).
    const rows = await queryMany<any>(
      `WITH item_stock AS (
         SELECT
           oi.order_id,
           oi.quantity::numeric                                    AS req_qty,
           COALESCE(
             psv.inventory_quantity,
             pv.inventory_quantity,
             p.inventory_quantity,
             0
           )::numeric                                              AS avail_qty,
           oi.product_id IS NOT NULL                               AS tracked
         FROM order_items oi
         LEFT JOIN product_sub_variants psv ON psv.id = oi.sub_variant_id
         LEFT JOIN product_variants     pv  ON pv.id  = oi.variant_id
         LEFT JOIN products             p   ON p.id   = oi.product_id
       ),
       draft_stock AS (
         SELECT
           order_id,
           COUNT(*) FILTER (WHERE tracked)                         AS total_tracked_items,
           COUNT(*) FILTER (WHERE tracked AND avail_qty < req_qty) AS short_items,
           COUNT(*) FILTER (WHERE tracked AND avail_qty <= 0)      AS out_of_stock_items
         FROM item_stock
         GROUP BY order_id
       )
       SELECT
         o.id, o.order_number, o.customer_name, o.customer_phone,
         o.total_amount, o.source, o.created_at, o.updated_at,
         COALESCE(ds.total_tracked_items, 0)::int  AS total_items,
         COALESCE(ds.short_items, 0)::int          AS short_items,
         COALESCE(ds.out_of_stock_items, 0)::int   AS out_of_stock_items
       FROM orders o
       LEFT JOIN draft_stock ds ON ds.order_id = o.id
       WHERE o.status = 'draft' AND o.source != 'cash_sale'
       ORDER BY o.updated_at DESC
       LIMIT 100`
    )

    return NextResponse.json({ drafts: rows || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const {
      customerName, customerPhone, customerEmail,
      addressLine1, addressLine2, city, state, postalCode,
      buyerGstin, paymentMode, notes, items,
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

    for (const item of (items || [])) {
      const qtyErr = await validateLineItemQty(item.product_id, item.variant_id, parseFloat(item.quantity) || 0)
      if (qtyErr) return NextResponse.json({ error: qtyErr }, { status: 400 })
    }

    const processedItems = (items || []).map((item: any) => {
      const unitPrice = parseFloat(item.unit_price) || 0
      const qty = parseFloat(item.quantity) || 0
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')
      const lineTotal = Math.round(lineItemFromMrpIncl(qty, unitPrice, discPct, gstRate) * 100) / 100
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
        total_price: lineTotal,
        taxable_amount: Math.round(gst.taxableAmount * 100) / 100,
        cgst_amount: Math.round(gst.cgst * 100) / 100,
        sgst_amount: Math.round(gst.sgst * 100) / 100,
        igst_amount: Math.round(gst.igst * 100) / 100,
        tax_amount: Math.round((gst.cgst + gst.sgst + gst.igst) * 100) / 100,
      }
    })

    const taxAmount = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100
    const totalAmount = Math.round(subtotal * 100) / 100

    const result = await withTransaction(async (client) => {
      const addrResult = await client.query(
        `INSERT INTO addresses (full_name, address_line1, address_line2, city, state, postal_code, phone, address_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'shipping')
         RETURNING id`,
        [customerName, addressLine1 || '', addressLine2 || null, city || '', state || '', postalCode || '', customerPhone || '']
      )
      const addressId = addrResult.rows[0].id

      const ts = Date.now()
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
      const orderNumber = `DFT-${ts}-${rand}`

      const orderResult = await client.query(
        `INSERT INTO orders (
          order_number, customer_name, customer_phone, customer_email,
          subtotal, tax_amount, total_amount, discount_amount, shipping_amount,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
          buyer_gstin, payment_status, status, source,
          shipping_address_id, billing_address_id, notes
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, 0, 0,
          $8, $9, $10, $11, $12,
          $13, $14, 'draft', 'offline',
          $15, $15, $16
        ) RETURNING id, order_number`,
        [
          orderNumber, customerName, customerPhone || '', customerEmail || '',
          subtotal, taxAmount, totalAmount,
          Math.round(totalTaxable * 100) / 100,
          Math.round(totalCgst * 100) / 100,
          Math.round(totalSgst * 100) / 100,
          Math.round(totalIgst * 100) / 100,
          orderIsIgst,
          buyerGstin || null,
          paymentMode === 'credit' ? 'unpaid' : 'paid',
          addressId,
          notes || null,
        ]
      )
      const orderId = orderResult.rows[0].id

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name,
            hsn_code, gst_rate, quantity, unit_price, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16,$17)`,
          [
            orderId, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name,
            item.hsn_code, item.gst_rate, item.quantity, item.unit_price,
            item.tax_amount, item.total_price, item.taxable_amount,
            item.cgst_amount, item.sgst_amount, item.igst_amount,
          ]
        )
      }

      return { orderId, orderNumber: orderResult.rows[0].order_number }
    })

    return NextResponse.json({ success: true, draftId: result.orderId, orderNumber: result.orderNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
