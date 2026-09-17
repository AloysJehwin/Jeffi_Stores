import type { PoolClient } from 'pg'
import { queryOne, withTransaction } from '@/lib/db'
import { calculateGST, round2 } from '@/lib/gst'
import { pickUnitPrice } from '@/lib/pricing'
import { getFeatureFlags } from '@/lib/site-controls'
import { logActivity } from '@/lib/activity'

// ── Post-order variant / sub-variant change ────────────────────────────────
// Admin swaps an ordered variant/sub-variant for another variant of the SAME
// product on a CONFIRMED (pre-shipment) order. The customer confirms; the price
// difference is settled (refund / collect / cod_adjust). This module holds the
// money-critical primitives shared by the request/confirm routes and the
// collect-payment verify hook. All prices honour the GST feature flag exactly
// like commitOrder (src/lib/order-commit.ts).

export interface VariantChangeRow {
  id: string
  order_id: string
  order_item_id: string
  old_variant_id: string | null
  old_sub_variant_id: string | null
  new_variant_id: string | null
  new_sub_variant_id: string | null
  old_unit_price: string | number
  new_unit_price: string | number
  qty: string | number
  price_diff: string | number
  settlement_type: 'refund' | 'collect' | 'cod_adjust' | 'none'
  status: 'pending_customer' | 'awaiting_payment' | 'applied' | 'rejected' | 'cancelled'
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  refund_id: string | null
}

/** A variant or sub-variant candidate for the swap, with the fields we price on. */
export interface VariantPriceRow {
  id: string
  name: string | null                 // variant_name / sub_variant_name
  sku: string | null                  // variant/sub-variant SKU (falls back to product SKU)
  product_name: string | null         // parent product name (for rebuilding order_items.product_name)
  parent_variant_name: string | null  // for a sub-variant: its parent variant_name (else null)
  price: number | null                // GST-inclusive
  price_ex_gst: number | null
  mrp: number | null
  gst_percentage: string | number | null
}

/**
 * Rebuild order_items.product_name exactly as commitOrder does
 * (src/lib/order-commit.ts): "<product>[ - <variant>][ - <sub-variant>]".
 * For a sub-variant swap `name` is the sub-variant name and parent_variant_name
 * the variant; for a variant swap `name` is the variant name and parent is null.
 */
function buildProductName(newV: VariantPriceRow, isSubVariant: boolean): string {
  const product = newV.product_name || ''
  if (isSubVariant) {
    const parent = newV.parent_variant_name ? ` - ${newV.parent_variant_name}` : ''
    return `${product}${parent} - ${newV.name ?? ''}`
  }
  return newV.name ? `${product} - ${newV.name}` : product
}

/**
 * Compute the price preview for swapping an order item to `newV`. Used by BOTH
 * the admin create-request and any preview endpoint so they never disagree.
 * The new unit price honours the GST flag (ex-GST when off) via pickUnitPrice.
 */
export function computeVariantChangePreview(params: {
  oldUnitPrice: number
  qty: number
  newV: VariantPriceRow
  gstEnabled: boolean
}): { oldUnitPrice: number; newUnitPrice: number; priceDiff: number; settlementType: 'refund' | 'collect' | 'none'; codSettlement: 'cod_adjust' } {
  const newUnitPrice = round2(pickUnitPrice({ inclusive: params.newV.price, exGst: params.newV.price_ex_gst }, params.gstEnabled))
  // Signed difference on the whole line (new − old) × qty.
  const priceDiff = round2((newUnitPrice - params.oldUnitPrice) * params.qty)
  const settlementType = priceDiff < 0 ? 'refund' : priceDiff > 0 ? 'collect' : 'none'
  return { oldUnitPrice: round2(params.oldUnitPrice), newUnitPrice, priceDiff, settlementType, codSettlement: 'cod_adjust' }
}

/** Load a variant or sub-variant priceable row (sub-variant preferred when given). */
export async function loadVariantPriceRow(
  variantId: string | null,
  subVariantId: string | null,
  productId: string,
): Promise<VariantPriceRow | null> {
  if (subVariantId) {
    return queryOne<VariantPriceRow>(
      `SELECT psv.id, psv.sub_variant_name AS name,
              COALESCE(NULLIF(psv.sku, ''), p.sku) AS sku,
              p.name AS product_name, pv.variant_name AS parent_variant_name,
              psv.price, psv.price_ex_gst, psv.mrp,
              p.gst_percentage
         FROM product_sub_variants psv
         JOIN products p ON p.id = $2
         LEFT JOIN product_variants pv ON pv.id = psv.variant_id
        WHERE psv.id = $1 AND psv.is_active = true`,
      [subVariantId, productId]
    )
  }
  if (variantId) {
    return queryOne<VariantPriceRow>(
      `SELECT pv.id, pv.variant_name AS name,
              COALESCE(NULLIF(pv.sku, ''), p.sku) AS sku,
              p.name AS product_name, NULL::text AS parent_variant_name,
              pv.price, pv.price_ex_gst, pv.mrp,
              p.gst_percentage
         FROM product_variants pv
         JOIN products p ON p.id = $2
        WHERE pv.id = $1 AND pv.is_active = true`,
      [variantId, productId]
    )
  }
  return null
}

interface OrderRow {
  id: string
  order_number: string
  user_id: string | null
  status: string
  payment_status: string
  payment_mode: string | null
  awb_number: string | null
  is_igst: boolean
}

/**
 * Idempotently apply an approved variant change: swap the order_items row to the
 * new variant/sub-variant, recompute its price/tax (GST-flag-aware), then re-sum
 * ALL of the order's items into the order totals. Re-asserts the guard
 * (status='confirmed' && no awb) at apply time — the order may have advanced to
 * processing between request and confirmation. No stock change (stock is only
 * deducted when the order moves to processing). Runs in one transaction.
 *
 * Returns { applied: true } on success, or { applied: false, reason } if the
 * request was already applied (idempotent) or the guard no longer holds.
 */
export async function applyVariantChange(
  vcrId: string,
  actorAdminId?: string | null,
): Promise<{ applied: boolean; reason?: string }> {
  const { gstEnabled } = await getFeatureFlags()

  return withTransaction(async (client: PoolClient) => {
    const vcrRes = await client.query(
      `SELECT * FROM variant_change_requests WHERE id = $1 FOR UPDATE`,
      [vcrId]
    )
    const vcr = vcrRes.rows[0] as VariantChangeRow | undefined
    if (!vcr) return { applied: false, reason: 'not_found' }
    if (vcr.status === 'applied') return { applied: false, reason: 'already_applied' } // idempotent
    if (vcr.status === 'rejected' || vcr.status === 'cancelled') {
      return { applied: false, reason: 'not_active' }
    }

    // Re-assert the guard against the LIVE order state.
    const ordRes = await client.query(
      `SELECT id, order_number, user_id, status, payment_status, payment_mode, awb_number, is_igst
         FROM orders WHERE id = $1 FOR UPDATE`,
      [vcr.order_id]
    )
    const order = ordRes.rows[0] as OrderRow | undefined
    if (!order) return { applied: false, reason: 'order_not_found' }
    if (order.status !== 'confirmed' || order.awb_number) {
      return { applied: false, reason: 'order_not_eligible' } // moved to processing/shipped
    }

    // Load the order item + the target variant/sub-variant priceable row.
    const itemRes = await client.query(
      `SELECT id, product_id, quantity, gst_rate FROM order_items WHERE id = $1 AND order_id = $2`,
      [vcr.order_item_id, vcr.order_id]
    )
    const item = itemRes.rows[0] as { id: string; product_id: string; quantity: string; gst_rate: string | null } | undefined
    if (!item) return { applied: false, reason: 'item_not_found' }

    const newV = await loadVariantPriceRow(vcr.new_variant_id, vcr.new_sub_variant_id, item.product_id)
    if (!newV) return { applied: false, reason: 'new_variant_unavailable' }

    const qty = Number(item.quantity) || 1
    // A 'none' settlement moves no money, so the line keeps the price quoted on the request
    // (the current price when the admin waived the difference) instead of the catalogue price.
    const unitPrice = vcr.settlement_type === 'none'
      ? round2(Number(vcr.new_unit_price))
      : round2(pickUnitPrice({ inclusive: newV.price, exGst: newV.price_ex_gst }, gstEnabled))
    const itemTotal = round2(unitPrice * qty)
    const gstRate = parseFloat(String(newV.gst_percentage ?? item.gst_rate ?? '0'))

    // GST split for the swapped line (only when GST is on — ex-GST prices carry no tax).
    const gst = gstEnabled ? calculateGST(itemTotal, gstRate, order.is_igst) : null

    const isSubVariant = !!vcr.new_sub_variant_id
    const newProductName = buildProductName(newV, isSubVariant)

    await client.query(
      `UPDATE order_items SET
         variant_id = $1, sub_variant_id = $2, variant_name = $3, product_sku = $4, product_name = $5,
         unit_price = $6, total_price = $7, mrp = $8,
         gst_rate = $9, taxable_amount = $10, cgst_amount = $11, sgst_amount = $12, igst_amount = $13, tax_amount = $14
       WHERE id = $15`,
      [
        vcr.new_variant_id, vcr.new_sub_variant_id, newV.name, newV.sku ?? null, newProductName,
        unitPrice, itemTotal, newV.mrp,
        gstEnabled ? gstRate : null,
        gst ? gst.taxableAmount : 0,
        gst ? gst.cgst : 0,
        gst ? gst.sgst : 0,
        gst ? gst.igst : 0,
        gst ? gst.totalTax : 0,
        item.id,
      ]
    )

    // Re-sum ALL items → order totals (keep existing discounts + shipping).
    const sumRes = await client.query(
      `SELECT
         COALESCE(SUM(total_price), 0) AS subtotal,
         COALESCE(SUM(taxable_amount), 0) AS taxable,
         COALESCE(SUM(cgst_amount), 0) AS cgst,
         COALESCE(SUM(sgst_amount), 0) AS sgst,
         COALESCE(SUM(igst_amount), 0) AS igst,
         COALESCE(SUM(tax_amount), 0) AS tax
       FROM order_items WHERE order_id = $1`,
      [vcr.order_id]
    )
    const s = sumRes.rows[0]
    const curRes = await client.query(
      `SELECT discount_amount, business_discount_amount, shipping_amount FROM orders WHERE id = $1`,
      [vcr.order_id]
    )
    const cur = curRes.rows[0]
    const subtotal = round2(Number(s.subtotal))
    const discount = round2(Number(cur.discount_amount || 0))
    const bizDiscount = round2(Number(cur.business_discount_amount || 0))
    const shipping = round2(Number(cur.shipping_amount || 0))
    const total = round2(Math.max(0, subtotal - discount - bizDiscount + shipping))

    await client.query(
      `UPDATE orders SET
         subtotal = $1, taxable_amount = $2, cgst_amount = $3, sgst_amount = $4, igst_amount = $5,
         tax_amount = $6, total_amount = $7, updated_at = NOW()
       WHERE id = $8`,
      [
        subtotal,
        gstEnabled ? round2(Number(s.taxable)) : 0,
        gstEnabled ? round2(Number(s.cgst)) : 0,
        gstEnabled ? round2(Number(s.sgst)) : 0,
        gstEnabled ? round2(Number(s.igst)) : 0,
        gstEnabled ? round2(Number(s.tax)) : 0,
        total,
        vcr.order_id,
      ]
    )

    await client.query(
      `UPDATE variant_change_requests SET status = 'applied', applied_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [vcrId]
    )

    if (order.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: actorAdminId ?? null,
        kind: 'variant_change',
        referenceId: vcr.order_id,
        referenceType: 'orders',
        summary: `Variant change applied on #${order.order_number} (${vcr.settlement_type}, ₹${Math.abs(Number(vcr.price_diff)).toFixed(2)})`,
        metadata: { vcrId, settlement: vcr.settlement_type, priceDiff: Number(vcr.price_diff), newTotal: total },
      }).catch(() => {})
    }

    return { applied: true }
  })
}

/**
 * Collect path: called by the razorpay verify/webhook hook once the customer's
 * top-up payment for the difference is confirmed. Records the extra payment
 * against the order and then applies the swap.
 */
export async function settleVariantChangePayment(params: {
  razorpayOrderId: string
  razorpayPaymentId: string
  amountPaise: number
}): Promise<{ applied: boolean; reason?: string }> {
  const vcr = await queryOne<VariantChangeRow>(
    `SELECT * FROM variant_change_requests WHERE razorpay_order_id = $1`,
    [params.razorpayOrderId]
  )
  if (!vcr) return { applied: false, reason: 'no_request' }
  if (vcr.status === 'applied') return { applied: false, reason: 'already_applied' }

  // Record the top-up payment against the order.
  await queryOne(
    `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'completed', $4)
     ON CONFLICT (transaction_id) DO NOTHING
     RETURNING id`,
    [
      vcr.order_id,
      params.razorpayPaymentId,
      (params.amountPaise / 100).toFixed(2),
      JSON.stringify({ purpose: 'variant_change', vcrId: vcr.id, razorpay_order_id: params.razorpayOrderId, razorpay_payment_id: params.razorpayPaymentId }),
    ]
  )
  await queryOne(
    `UPDATE variant_change_requests SET razorpay_payment_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
    [params.razorpayPaymentId, vcr.id]
  )

  return applyVariantChange(vcr.id)
}
