import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, withTransaction } from '@/lib/db'
import { isInterState, calculateGST, round2 } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    // For each draft, count how many of its line items are short on stock.
    // A line is "short" when the chosen sub_variant / variant / product has
    // less inventory than the requested qty. Each line-item is checked at the
    // most specific level it targets (sub_variant > variant > product).
    const rows = await queryMany<any>(
      `WITH item_stock AS (
         SELECT
           oi.order_id,
           oi.product_name,
           oi.variant_name,
           oi.buy_unit,
           oi.quantity::numeric                                     AS raw_qty,
           -- Resolve factor via 5-level fallback so RFQ-converted items (buy_unit NULL)
           -- still get the correct factor from oi.unit, sell_unit_id, or sold_unit_factor.
           (oi.quantity::numeric * COALESCE(
             CASE WHEN COALESCE(puv.dimension, pup.dimension,
                                puuv.dimension, puup.dimension,
                                pu_sv.dimension, pu_sp.dimension) = 'count'
                  THEN COALESCE(puv.factor, pup.factor,
                                puuv.factor, puup.factor,
                                pu_sv.factor, pu_sp.factor)
                  ELSE 1 END,
             CASE WHEN oi.sold_unit_factor IS NOT NULL THEN oi.sold_unit_factor ELSE 1 END
           ))                                                      AS req_qty,
           -- Target the most-specific stock level; do NOT fall through to a broader
           -- level — a sub-variant with 0 stock must not inherit variant/product stock.
           -- For perishable products, add batch quantity_remaining to inventory_quantity.
           CASE
             WHEN oi.sub_variant_id IS NOT NULL THEN COALESCE(psv.inventory_quantity, 0)
               + CASE WHEN p.perishable AND NOT p.serialized THEN COALESCE((SELECT SUM(pb.quantity_remaining) FROM product_batches pb WHERE pb.product_id = oi.product_id AND pb.variant_id = oi.variant_id AND pb.sub_variant_id = oi.sub_variant_id AND pb.quantity_remaining > 0), 0) ELSE 0 END
             WHEN oi.variant_id IS NOT NULL THEN COALESCE(pv.inventory_quantity, 0)
               + CASE WHEN p.perishable AND NOT p.serialized THEN COALESCE((SELECT SUM(pb.quantity_remaining) FROM product_batches pb WHERE pb.product_id = oi.product_id AND pb.variant_id = oi.variant_id AND pb.sub_variant_id IS NULL AND pb.quantity_remaining > 0), 0) ELSE 0 END
             ELSE COALESCE(p.inventory_quantity, 0)
               + CASE WHEN p.perishable AND NOT p.serialized THEN COALESCE((SELECT SUM(pb.quantity_remaining) FROM product_batches pb WHERE pb.product_id = oi.product_id AND pb.variant_id IS NULL AND pb.sub_variant_id IS NULL AND pb.quantity_remaining > 0), 0) ELSE 0 END
           END::numeric                                            AS avail_qty,
           oi.product_id IS NOT NULL                               AS tracked
         FROM order_items oi
         LEFT JOIN product_sub_variants psv  ON psv.id  = oi.sub_variant_id
         LEFT JOIN product_variants     pv   ON pv.id   = oi.variant_id
         LEFT JOIN products             p    ON p.id    = oi.product_id
         LEFT JOIN product_variants     pvar ON pvar.id = oi.variant_id
         -- buy_unit path (manually created invoices)
         LEFT JOIN product_units puv  ON puv.unit  = oi.buy_unit AND puv.product_id = oi.product_id AND puv.variant_id = oi.variant_id AND oi.buy_unit IS NOT NULL
         LEFT JOIN product_units pup  ON pup.unit  = oi.buy_unit AND pup.product_id = oi.product_id AND pup.variant_id IS NULL         AND oi.buy_unit IS NOT NULL
         -- oi.sold_unit fallback (RFQ-converted items where buy_unit is NULL)
         LEFT JOIN product_units puuv ON puuv.unit = oi.sold_unit AND puuv.product_id = oi.product_id AND puuv.variant_id = oi.variant_id AND oi.buy_unit IS NULL AND oi.sold_unit_factor IS NULL
         LEFT JOIN product_units puup ON puup.unit = oi.sold_unit AND puup.product_id = oi.product_id AND puup.variant_id IS NULL         AND oi.buy_unit IS NULL AND oi.sold_unit_factor IS NULL
         -- sell_unit_id fallback (default selling unit from variant/product); reuse p alias for products
         LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL AND puuv.id IS NULL AND puup.id IS NULL
         LEFT JOIN product_units pu_sp ON pu_sp.id = p.sell_unit_id    AND puv.id IS NULL AND pup.id IS NULL AND puuv.id IS NULL AND puup.id IS NULL
       ),
       draft_stock AS (
         SELECT
           order_id,
           COUNT(*) FILTER (WHERE tracked)                         AS total_tracked_items,
           COUNT(*) FILTER (WHERE tracked AND avail_qty < req_qty) AS short_items,
           COUNT(*) FILTER (WHERE tracked AND avail_qty <= 0)      AS out_of_stock_items,
           COALESCE(
             json_agg(
               json_build_object(
                 'product_name', product_name,
                 'variant_name', variant_name,
                 'buy_unit',     buy_unit,
                 'raw_qty',      raw_qty,
                 'req_qty',      req_qty,
                 'avail_qty',    avail_qty,
                 'ok',           avail_qty >= req_qty
               ) ORDER BY product_name, variant_name
             ) FILTER (WHERE tracked),
             '[]'
           )                                                       AS stock_lines
         FROM item_stock
         GROUP BY order_id
       )
       SELECT
         o.id, o.order_number, o.customer_name, o.customer_phone,
         o.total_amount, o.source, o.created_at, o.updated_at,
         COALESCE(ds.total_tracked_items, 0)::int  AS total_items,
         COALESCE(ds.short_items, 0)::int          AS short_items,
         COALESCE(ds.out_of_stock_items, 0)::int   AS out_of_stock_items,
         COALESCE(ds.stock_lines, '[]'::json)      AS stock_lines
       FROM orders o
       LEFT JOIN draft_stock ds ON ds.order_id = o.id
       WHERE (o.status = 'draft' AND o.source != 'cash_sale')
          OR (o.status = 'confirmed' AND EXISTS (
               SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'draft'
             ))
          OR (o.status = 'processing' AND o.source IN ('business', 'offline') AND o.invoice_number IS NULL)
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
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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

    const processedItems = (items || []).map((item: any) => {
      const unitPrice = parseFloat(item.unit_price) || 0
      const qty = parseFloat(item.quantity) || 0
      const factor = item.sell_unit_factor && item.sell_unit_factor > 1 ? item.sell_unit_factor : 1
      const baseQty = qty * factor
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')
      const lineTotal = round2(lineItemFromMrpIncl(baseQty, unitPrice, discPct, gstRate))
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
        buy_unit: item.buy_unit || null,
        sold_unit_factor: factor > 1 ? factor : null,
        base_quantity: factor > 1 ? baseQty : null,
        unit_price: unitPrice,
        mrp: unitPrice,
        discount_pct: discPct,
        discount_amount: discPct > 0 ? round2(baseQty * unitPrice / (1 + gstRate / 100) * (discPct / 100)) : 0,
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
          round2(totalTaxable),
          round2(totalCgst),
          round2(totalSgst),
          round2(totalIgst),
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
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name, sub_variant_name,
            hsn_code, gst_rate, quantity, buy_unit, sold_unit_factor, base_quantity,
            unit_price, mrp, discount_pct, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
          [
            orderId, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name, item.sub_variant_name ?? null,
            item.hsn_code, item.gst_rate, item.quantity, item.buy_unit,
            item.sold_unit_factor ?? null, item.base_quantity ?? null,
            item.unit_price, item.mrp, item.discount_pct, item.discount_amount,
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
