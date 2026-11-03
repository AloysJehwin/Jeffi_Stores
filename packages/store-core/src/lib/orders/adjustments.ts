import type { PoolClient } from 'pg'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { calculateGST, round2 } from '@/lib/catalog/gst'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { resolveBuyNowItem } from '@/lib/orders/order-commit'
import { sellingUnitsFor } from '@/lib/catalog/unit-factor'
import { logActivity } from '@/lib/shared/activity'

// ── Product adjustments ─────────────────────────────────────────────────────
// On a CONFIRMED, not-yet-shipped order the admin changes several lines at once: switch a line to another
// product / variant / sub-variant / selling unit, change its quantity, or remove it. The customer approves;
// the net difference is refunded, collected, absorbed into the COD total, or waived. Shipping stays as paid;
// the order discount is prorated by value (a removed or reduced line takes its share with it; it never grows).
// Stock isn't touched: it is deducted when the order moves to processing.

export type AdjAction = 'switch' | 'remove' | 'quantity'
export type Settlement = 'refund' | 'collect' | 'cod_adjust' | 'none'

export interface AdjLineInput {
  orderItemId: string
  action: AdjAction
  productId?: string
  variantId?: string | null
  subVariantId?: string | null
  unit?: string | null
  quantity?: number
}

interface ItemRow {
  id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  product_name: string
  product_sku: string | null
  variant_name: string | null
  sub_variant_name: string | null
  quantity: string
  unit_price: string
  total_price: string
  mrp: string | null
  gst_rate: string | null
  hsn_code: string | null
  buy_mode: string | null
  buy_unit: string | null
  sold_unit: string | null
  sold_unit_factor: string | null
  is_digital: boolean | null
}

export interface NewLine {
  productId: string
  variantId: string | null
  subVariantId: string | null
  productName: string
  sku: string | null
  variantName: string | null
  subVariantName: string | null
  unit: string | null
  factor: number
  quantity: number
  unitPrice: number
  total: number
  mrp: number | null
  gstRate: number | null
  hsn: string | null
  weightGrams: number | null
  packageType: string | null
  lengthCm: number | null
  breadthCm: number | null
  heightCm: number | null
}

export interface PreviewLine {
  orderItemId: string
  action: AdjAction
  old: { name: string; unit: string | null; quantity: number; unitPrice: number; total: number; paid: number }
  new: (NewLine & { paid: number }) | null
  diff: number
}

export interface AdjustmentPreview {
  lines: PreviewLine[]
  oldSubtotal: number
  newSubtotal: number
  oldDiscount: number
  newDiscount: number
  newCouponDiscount: number
  newBusinessDiscount: number
  oldTotal: number
  newTotal: number
  netDiff: number
  settlementType: Settlement
}

const ORDER_COLS = `id, order_number, user_id, status, payment_status, payment_mode, awb_number, is_igst,
  subtotal, discount_amount, business_discount_amount, shipping_amount, cod_fee_amount, total_amount`

const ITEM_COLS = `id, product_id, variant_id, sub_variant_id, product_name, product_sku, variant_name, sub_variant_name,
  quantity, unit_price, total_price, mrp, gst_rate, hsn_code, buy_mode, buy_unit, sold_unit, sold_unit_factor, is_digital`

export class AdjustmentError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const eligible = (o: { status: string; awb_number: string | null }) => o.status === 'confirmed' && !o.awb_number

/** Name, SKU, MRP, GST, HSN, weight and size of a switch target (sub-variant → variant → product). */
async function loadTarget(productId: string, variantId: string | null, subVariantId: string | null) {
  return queryOne<any>(
    `SELECT p.name AS product_name, pv.variant_name, sv.sub_variant_name,
            COALESCE(NULLIF(sv.sku, ''), NULLIF(pv.sku, ''), p.sku) AS sku,
            COALESCE(sv.mrp, pv.mrp, p.mrp) AS mrp, p.gst_percentage, p.hsn_code,
            COALESCE(sv.weight_grams, pv.weight_grams, p.weight_grams) AS weight_grams,
            COALESCE(sv.package_type, pv.package_type, p.package_type) AS package_type,
            COALESCE(sv.length_cm, pv.length_cm, p.length_cm) AS length_cm,
            COALESCE(sv.breadth_cm, pv.breadth_cm, p.breadth_cm) AS breadth_cm,
            COALESCE(sv.height_cm, pv.height_cm, p.height_cm) AS height_cm,
            p.is_active AS product_active
       FROM products p
       LEFT JOIN product_variants pv ON pv.id = $2::uuid AND pv.product_id = p.id
       LEFT JOIN product_sub_variants sv ON sv.id = $3::uuid
      WHERE p.id = $1`,
    [productId, variantId, subVariantId]
  )
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** Price the proposal with the same rules as checkout and work out who owes whom. */
export async function previewAdjustment(
  orderId: string,
  input: AdjLineInput[],
  settlePayment: boolean
): Promise<AdjustmentPreview> {
  const { gstEnabled } = await getFeatureFlags()
  const order = await queryOne<any>(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [orderId])
  if (!order) throw new AdjustmentError('Order not found', 404)
  if (!eligible(order)) throw new AdjustmentError('Only confirmed orders that have not shipped can be adjusted.')
  const items = await queryMany<ItemRow>(`SELECT ${ITEM_COLS} FROM order_items WHERE order_id = $1`, [orderId])
  const byId = new Map(items.map(i => [i.id, i]))

  const seen = new Set<string>()
  for (const l of input) {
    if (!byId.has(l.orderItemId)) throw new AdjustmentError('A changed line is not part of this order.')
    if (seen.has(l.orderItemId)) throw new AdjustmentError('Each order line can only be changed once per adjustment.')
    seen.add(l.orderItemId)
    if (byId.get(l.orderItemId)!.is_digital && l.action !== 'remove') throw new AdjustmentError('Digital items can only be removed.')
    if (l.action !== 'remove' && !(Number(l.quantity) > 0)) throw new AdjustmentError('Quantity must be more than 0.')
    if (l.action === 'switch' && !l.productId) throw new AdjustmentError('Pick the product to switch to.')
  }
  if (!input.length) throw new AdjustmentError('Nothing to change.')
  if (items.every(i => input.some(l => l.orderItemId === i.id && l.action === 'remove')))
    throw new AdjustmentError('Removing every item cancels the order — cancel it instead.')

  // New lines: switch targets priced like checkout; quantity changes keep the price the customer paid per unit.
  const switches = input.filter(l => l.action === 'switch')
  const units = await sellingUnitsFor(switches.map(l => ({ productId: l.productId, variantId: l.variantId, subVariantId: l.subVariantId, unit: l.unit })))
  const newLines = new Map<string, NewLine>()
  for (const [k, l] of switches.entries()) {
    const u = units[k]
    const priced = await resolveBuyNowItem({
      productId: l.productId!,
      variantId: l.variantId || null,
      subVariantId: l.subVariantId || null,
      qty: Number(l.quantity),
      buyMode: u.unit || 'unit',
      buyUnit: u.unit,
      gstEnabled,
    })
    if (!priced.ok) throw new AdjustmentError(priced.error)
    const t = await loadTarget(l.productId!, l.variantId || null, l.subVariantId || null)
    if (!t) throw new AdjustmentError('Product not found.')
    const name = [t.product_name, t.variant_name, t.sub_variant_name].filter(Boolean).join(' - ')
    const qty = Number(l.quantity)
    newLines.set(l.orderItemId, {
      productId: l.productId!, variantId: l.variantId || null, subVariantId: l.subVariantId || null,
      productName: name, sku: t.sku ?? null, variantName: t.variant_name ?? null, subVariantName: t.sub_variant_name ?? null,
      unit: u.unit, factor: u.factor, quantity: qty, unitPrice: priced.item.price, total: round2(priced.item.price * qty),
      mrp: num(t.mrp), gstRate: gstEnabled ? Number(t.gst_percentage ?? 0) : null, hsn: t.hsn_code ?? null,
      weightGrams: num(t.weight_grams), packageType: t.package_type ?? null,
      lengthCm: num(t.length_cm), breadthCm: num(t.breadth_cm), heightCm: num(t.height_cm),
    })
  }
  for (const l of input.filter(x => x.action === 'quantity')) {
    const it = byId.get(l.orderItemId)!
    const qty = Number(l.quantity)
    newLines.set(l.orderItemId, {
      productId: it.product_id, variantId: it.variant_id, subVariantId: it.sub_variant_id, productName: it.product_name,
      sku: it.product_sku, variantName: it.variant_name, subVariantName: it.sub_variant_name, unit: it.sold_unit,
      factor: Number(it.sold_unit_factor) || 1, quantity: qty, unitPrice: Number(it.unit_price), total: round2(Number(it.unit_price) * qty),
      mrp: num(it.mrp), gstRate: num(it.gst_rate), hsn: it.hsn_code, weightGrams: null, packageType: null,
      lengthCm: null, breadthCm: null, heightCm: null,
    })
  }

  const oldSubtotal = round2(items.reduce((s, i) => s + Number(i.total_price), 0))
  const changed = new Set(input.map(l => l.orderItemId))
  const newSubtotal = round2(
    items.filter(i => !changed.has(i.id)).reduce((s, i) => s + Number(i.total_price), 0) +
      [...newLines.values()].reduce((s, n) => s + n.total, 0)
  )
  const coupon = Number(order.discount_amount || 0)
  const biz = Number(order.business_discount_amount || 0)
  const oldDiscount = round2(coupon + biz)
  const rate = oldSubtotal > 0 ? oldDiscount / oldSubtotal : 0
  // Settled: the discount rate carries over, capped at the original amount. Waived: the customer pays exactly
  // what they paid before, so the discount absorbs the difference.
  const newDiscount = settlePayment
    ? round2(Math.min(oldDiscount, rate * newSubtotal))
    : round2(Math.max(0, newSubtotal - (oldSubtotal - oldDiscount)))
  const couponShare = oldDiscount > 0 ? coupon / oldDiscount : 1
  const newCouponDiscount = round2(newDiscount * couponShare)
  const newBusinessDiscount = round2(newDiscount - newCouponDiscount)
  const extras = Number(order.shipping_amount || 0) + Number(order.cod_fee_amount || 0)
  const oldTotal = round2(Number(order.total_amount))
  const newTotal = round2(Math.max(0, newSubtotal - newDiscount + extras))
  const netDiff = round2(newSubtotal - newDiscount - (oldSubtotal - oldDiscount))

  const isCod = order.payment_mode === 'cod' && order.payment_status !== 'paid'
  const settlementType: Settlement =
    !settlePayment || netDiff === 0 ? 'none' : isCod ? 'cod_adjust' : netDiff < 0 ? 'refund' : 'collect'
  if (settlementType === 'refund' && order.payment_status !== 'paid')
    throw new AdjustmentError('This order is not paid online, so there is nothing to refund — turn off "Settle payment".')

  const newRate = newSubtotal > 0 ? newDiscount / newSubtotal : 0
  const lines: PreviewLine[] = input.map(l => {
    const it = byId.get(l.orderItemId)!
    const oldTotalLine = Number(it.total_price)
    const oldPaid = round2(oldTotalLine * (1 - rate))
    const n = newLines.get(l.orderItemId) ?? null
    const newPaid = n ? round2(n.total * (1 - newRate)) : 0
    return {
      orderItemId: l.orderItemId,
      action: l.action,
      old: { name: it.product_name, unit: it.sold_unit, quantity: Number(it.quantity), unitPrice: Number(it.unit_price), total: oldTotalLine, paid: oldPaid },
      new: n ? { ...n, paid: newPaid } : null,
      diff: round2(newPaid - oldPaid),
    }
  })
  return {
    lines, oldSubtotal, newSubtotal, oldDiscount, newDiscount, newCouponDiscount, newBusinessDiscount,
    oldTotal, newTotal, netDiff, settlementType,
  }
}

/** Store a proposal for the customer to approve. One open adjustment per order. */
export async function createAdjustment(params: {
  orderId: string
  lines: AdjLineInput[]
  settlePayment: boolean
  adminId?: string | null
  adminNotes?: string | null
}): Promise<{ id: string; preview: AdjustmentPreview }> {
  const preview = await previewAdjustment(params.orderId, params.lines, params.settlePayment)
  const open = await queryOne(
    `SELECT 1 FROM order_adjustments WHERE order_id = $1 AND status IN ('pending_customer','awaiting_payment')
     UNION ALL SELECT 1 FROM variant_change_requests WHERE order_id = $1 AND status IN ('pending_customer','awaiting_payment')`,
    [params.orderId]
  )
  if (open) throw new AdjustmentError('This order already has a change waiting for the customer. Cancel it first.', 409)
  const id = await withTransaction(async client => {
    const r = await client.query(
      `INSERT INTO order_adjustments (order_id, requested_by_admin_id, settle_payment, settlement_type, net_diff,
         old_subtotal, new_subtotal, old_discount, new_discount, new_business_discount, old_total, new_total, admin_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [params.orderId, params.adminId ?? null, params.settlePayment, preview.settlementType, preview.netDiff,
        preview.oldSubtotal, preview.newSubtotal, preview.oldDiscount, preview.newCouponDiscount, preview.newBusinessDiscount,
        preview.oldTotal, preview.newTotal, params.adminNotes ?? null]
    )
    const adjId = r.rows[0].id as string
    for (const l of preview.lines) {
      const n = l.new
      await client.query(
        `INSERT INTO order_adjustment_lines (adjustment_id, order_item_id, action, old_snapshot, new_product_id, new_variant_id,
           new_sub_variant_id, new_unit, new_unit_factor, new_quantity, new_unit_price, new_line, old_total, new_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [adjId, l.orderItemId, l.action, JSON.stringify(l.old), n?.productId ?? null, n?.variantId ?? null,
          n?.subVariantId ?? null, n?.unit ?? null, n?.factor ?? null, n?.quantity ?? null, n?.unitPrice ?? null,
          n ? JSON.stringify(n) : null, l.old.total, n?.total ?? 0]
      )
    }
    return adjId
  })
  return { id, preview }
}

/**
 * Re-sum the order's lines into its totals (same formula as checkout: subtotal − discounts + shipping + COD fee).
 * Discounts are replaced when given, else kept.
 */
export async function recalcOrderTotals(
  client: PoolClient,
  orderId: string,
  gstEnabled: boolean,
  discounts?: { coupon: number; business: number }
): Promise<number> {
  const s = (
    await client.query(
      `SELECT COALESCE(SUM(total_price),0) AS subtotal, COALESCE(SUM(taxable_amount),0) AS taxable,
              COALESCE(SUM(cgst_amount),0) AS cgst, COALESCE(SUM(sgst_amount),0) AS sgst,
              COALESCE(SUM(igst_amount),0) AS igst, COALESCE(SUM(tax_amount),0) AS tax
         FROM order_items WHERE order_id = $1`,
      [orderId]
    )
  ).rows[0]
  const cur = (
    await client.query(
      `SELECT discount_amount, business_discount_amount, shipping_amount, cod_fee_amount FROM orders WHERE id = $1`,
      [orderId]
    )
  ).rows[0]
  const subtotal = round2(Number(s.subtotal))
  const coupon = round2(discounts ? discounts.coupon : Number(cur.discount_amount || 0))
  const business = round2(discounts ? discounts.business : Number(cur.business_discount_amount || 0))
  const total = round2(Math.max(0, subtotal - coupon - business + Number(cur.shipping_amount || 0) + Number(cur.cod_fee_amount || 0)))
  const g = (v: unknown) => (gstEnabled ? round2(Number(v)) : 0)
  await client.query(
    `UPDATE orders SET subtotal = $1, taxable_amount = $2, cgst_amount = $3, sgst_amount = $4, igst_amount = $5,
       tax_amount = $6, discount_amount = $7, business_discount_amount = $8, total_amount = $9, updated_at = NOW()
     WHERE id = $10`,
    [subtotal, g(s.taxable), g(s.cgst), g(s.sgst), g(s.igst), g(s.tax), coupon, business, total, orderId]
  )
  return total
}

/** Apply an approved adjustment to the order (idempotent; re-checks the order is still adjustable). */
export async function applyAdjustment(adjId: string, actorAdminId?: string | null): Promise<{ applied: boolean; reason?: string }> {
  const { gstEnabled } = await getFeatureFlags()
  return withTransaction(async (client: PoolClient) => {
    const adj = (await client.query(`SELECT * FROM order_adjustments WHERE id = $1 FOR UPDATE`, [adjId])).rows[0]
    if (!adj) return { applied: false, reason: 'not_found' }
    if (adj.status === 'applied') return { applied: false, reason: 'already_applied' }
    if (adj.status === 'rejected' || adj.status === 'cancelled') return { applied: false, reason: 'not_active' }
    const order = (await client.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1 FOR UPDATE`, [adj.order_id])).rows[0]
    if (!order) return { applied: false, reason: 'order_not_found' }
    if (!eligible(order)) return { applied: false, reason: 'order_not_eligible' }

    const lines = (await client.query(`SELECT * FROM order_adjustment_lines WHERE adjustment_id = $1`, [adjId])).rows
    for (const l of lines) {
      if (l.action === 'remove') {
        await client.query(`DELETE FROM order_items WHERE id = $1 AND order_id = $2`, [l.order_item_id, adj.order_id])
        continue
      }
      const n = l.new_line as NewLine
      const gstRate = Number(n.gstRate ?? 0)
      const gst = gstEnabled && gstRate > 0 ? calculateGST(n.total, gstRate, order.is_igst) : null
      const tax = [gst ? gst.taxableAmount : gstEnabled ? n.total : 0, gst?.cgst ?? 0, gst?.sgst ?? 0, gst?.igst ?? 0, gst?.totalTax ?? 0]
      if (l.action === 'quantity') {
        await client.query(
          `UPDATE order_items SET quantity = $1, total_price = $2, taxable_amount = $3, cgst_amount = $4, sgst_amount = $5,
             igst_amount = $6, tax_amount = $7, base_quantity = $8 * COALESCE(sold_unit_factor, 1)
           WHERE id = $9 AND order_id = $10`,
          [n.quantity, n.total, ...tax, n.quantity, l.order_item_id, adj.order_id]
        )
        continue
      }
      await client.query(
        `UPDATE order_items SET product_id = $1, variant_id = $2, sub_variant_id = $3, product_name = $4, product_sku = $5,
           variant_name = $6, sub_variant_name = $7, quantity = $8, unit_price = $9, total_price = $10, mrp = $11,
           gst_rate = $12, hsn_code = COALESCE($13, hsn_code), taxable_amount = $14, cgst_amount = $15, sgst_amount = $16,
           igst_amount = $17, tax_amount = $18, buy_mode = $19, buy_unit = $20, sold_unit = $21, sold_unit_factor = $22,
           base_quantity = $23, discount_amount = 0, discount_pct = 0, applied_rules = NULL,
           weight_grams = $24, package_type = $25, length_cm = $26, breadth_cm = $27, height_cm = $28
         WHERE id = $29 AND order_id = $30`,
        [n.productId, n.variantId, n.subVariantId, n.productName, n.sku, n.variantName, n.subVariantName, n.quantity,
          n.unitPrice, n.total, n.mrp, gstEnabled ? gstRate : null, n.hsn, ...tax, n.unit || 'unit', n.unit, n.unit,
          n.factor, n.quantity * n.factor, n.weightGrams, n.packageType, n.lengthCm, n.breadthCm, n.heightCm,
          l.order_item_id, adj.order_id]
      )
    }
    const total = await recalcOrderTotals(client, adj.order_id, gstEnabled, {
      coupon: Number(adj.new_discount),
      business: Number(adj.new_business_discount),
    })
    await client.query(`UPDATE order_adjustments SET status = 'applied', applied_at = NOW(), updated_at = NOW() WHERE id = $1`, [adjId])
    if (order.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: actorAdminId ?? null,
        kind: 'order_adjustment',
        referenceId: adj.order_id,
        referenceType: 'orders',
        summary: `Order #${order.order_number} adjusted (${lines.length} line${lines.length === 1 ? '' : 's'}, ${adj.settlement_type} ₹${Math.abs(Number(adj.net_diff)).toFixed(2)})`,
        metadata: { adjId, settlement: adj.settlement_type, netDiff: Number(adj.net_diff), newTotal: total },
      }).catch(() => {})
    }
    return { applied: true }
  })
}

/**
 * The customer paid the extra (verify callback or webhook): record the payment, credit the tenant's share for
 * platform-collected tenants, then apply.
 */
export async function settleAdjustmentPayment(params: {
  razorpayOrderId: string
  razorpayPaymentId: string
  amountPaise: number
  tenant?: { tenantId?: string | null; slug?: string | null } | null
}): Promise<{ applied: boolean; reason?: string }> {
  const adj = await queryOne<any>(
    `SELECT a.*, o.order_number FROM order_adjustments a JOIN orders o ON o.id = a.order_id WHERE a.razorpay_order_id = $1`,
    [params.razorpayOrderId]
  )
  if (!adj) return { applied: false, reason: 'no_request' }
  if (adj.status === 'applied') return { applied: false, reason: 'already_applied' }
  const amount = params.amountPaise > 0 ? params.amountPaise / 100 : Math.abs(Number(adj.net_diff))
  const inserted = await queryOne(
    `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'completed', $4)
     ON CONFLICT (transaction_id) DO NOTHING RETURNING id`,
    [adj.order_id, params.razorpayPaymentId, amount.toFixed(2),
      JSON.stringify({ purpose: 'order_adjustment', adjustmentId: adj.id, razorpay_order_id: params.razorpayOrderId, razorpay_payment_id: params.razorpayPaymentId })]
  )
  await queryOne(`UPDATE order_adjustments SET razorpay_payment_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [params.razorpayPaymentId, adj.id])
  if (inserted && params.tenant?.tenantId) {
    const { recordCapturedPayment } = await import('@/lib/payments/route-settlement')
    const { resolveRazorpayCreds } = await import('@/lib/integrations/resolve')
    const { isOwn } = await resolveRazorpayCreds(params.tenant.tenantId).catch(() => ({ isOwn: false }))
    await recordCapturedPayment({
      tenantId: params.tenant.tenantId,
      tenantSlug: params.tenant.slug ?? '',
      orderRef: `${adj.order_number}#adj-${String(adj.id).slice(0, 8)}`,
      orderId: adj.order_id,
      paymentId: params.razorpayPaymentId,
      grossInr: amount,
      collectedOn: isOwn ? 'own' : 'platform',
    }).catch(e => console.error('[order-adjustment] ledger record failed', e))
  }
  return applyAdjustment(adj.id)
}
