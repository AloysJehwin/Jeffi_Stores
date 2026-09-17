import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { getFeatureFlags } from '@/lib/site-controls'
import { computeVariantChangePreview, loadVariantPriceRow } from '@/lib/variant-change'
import { notifyVariantChangeRequested } from '@/lib/notify'
import { sendVariantChangeRequestedEmail } from '@/lib/email'
import { logActivity } from '@/lib/activity'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'
import { queryMany } from '@/lib/db'
import { pickUnitPrice } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

// GET /api/admin/orders/[id]/variant-change?productId=... — list swap candidates
// (active variants + sub-variants of the same product, with dimensions + price).
// ?history=1 — return this order's variant-change request history with status.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    // History mode: return this order's variant-change requests with status.
    if (request.nextUrl.searchParams.get('history')) {
      const history = await queryMany<any>(
        `SELECT vcr.id, vcr.status, vcr.settlement_type, vcr.price_diff, vcr.old_unit_price, vcr.new_unit_price,
                vcr.created_at, vcr.applied_at, oi.product_name,
                vcr.old_variant_name, vcr.new_variant_name
         FROM variant_change_requests vcr
         JOIN order_items oi ON oi.id = vcr.order_item_id
         WHERE vcr.order_id = $1 ORDER BY vcr.created_at DESC`,
        [orderId]
      )
      return NextResponse.json({ history })
    }

    const productId = request.nextUrl.searchParams.get('productId')
    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })
    const { gstEnabled } = await getFeatureFlags()

    const variants = await queryMany<any>(
      `SELECT pv.id, pv.variant_name AS name, pv.sku, pv.price, pv.price_ex_gst, pv.mrp, pv.stock_status,
              pv.length_cm, pv.breadth_cm, pv.height_cm, pv.weight_grams
       FROM product_variants pv WHERE pv.product_id = $1 AND pv.is_active = true ORDER BY pv.variant_name`,
      [productId]
    )
    const subVariants = await queryMany<any>(
      `SELECT psv.id, psv.sub_variant_name AS name, psv.sku, psv.price, psv.price_ex_gst, psv.mrp, psv.stock_status,
              psv.variant_id, pv.variant_name AS parent_variant_name,
              pv.length_cm, pv.breadth_cm, pv.height_cm, pv.weight_grams
       FROM product_sub_variants psv JOIN product_variants pv ON pv.id = psv.variant_id
       WHERE psv.product_id = $1 AND psv.is_active = true ORDER BY pv.variant_name, psv.sub_variant_name`,
      [productId]
    )
    const withPrice = (r: any) => ({ ...r, effectivePrice: pickUnitPrice({ inclusive: r.price, exGst: r.price_ex_gst }, gstEnabled) })
    return NextResponse.json({
      variants: variants.map(withPrice),
      subVariants: subVariants.map(withPrice),
      gstEnabled,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load variants' }, { status: 500 })
  }
}

const bodySchema = z.object({
  orderItemId: zUuid,
  newVariantId: zUuid.nullish(),
  newSubVariantId: zUuid.nullish(),
  adminNotes: z.string().max(1000).optional(),
  settlePayment: z.boolean().optional(),
}).refine(d => d.newVariantId || d.newSubVariantId, { message: 'A replacement variant or sub-variant is required' })

// POST /api/admin/orders/[id]/variant-change — admin proposes a variant swap.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const parsed = parseBody(bodySchema, await request.json())
    if (!parsed.ok) return parsed.response
    const { orderItemId, newVariantId, newSubVariantId, adminNotes } = parsed.data
    const settlePayment = parsed.data.settlePayment !== false

    const order = await queryOne<any>(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_mode, o.awb_number, o.user_id,
              o.customer_email, o.customer_name,
              u.email AS user_email, u.first_name, u.last_name
       FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    // Guard: only confirmed, pre-shipment orders.
    if (order.status !== 'confirmed' || order.awb_number) {
      return NextResponse.json({ error: 'Variant change is only allowed on confirmed orders that have not shipped.' }, { status: 400 })
    }

    // No other active request on this order.
    const openReq = await queryOne(
      `SELECT id FROM variant_change_requests WHERE order_id = $1 AND status IN ('pending_customer','awaiting_payment') LIMIT 1`,
      [orderId]
    )
    if (openReq) return NextResponse.json({ error: 'A variant change request is already pending on this order.' }, { status: 409 })

    const item = await queryOne<any>(
      `SELECT id, product_id, variant_id, sub_variant_id, quantity, unit_price, variant_name FROM order_items WHERE id = $1 AND order_id = $2`,
      [orderItemId, orderId]
    )
    if (!item) return NextResponse.json({ error: 'Order item not found' }, { status: 404 })

    const { gstEnabled } = await getFeatureFlags()
    const newV = await loadVariantPriceRow(newVariantId ?? null, newSubVariantId ?? null, item.product_id)
    if (!newV) return NextResponse.json({ error: 'Replacement variant not found or inactive' }, { status: 404 })

    const qty = Number(item.quantity) || 1
    const listPreview = computeVariantChangePreview({
      oldUnitPrice: Number(item.unit_price),
      qty,
      newV,
      gstEnabled,
    })
    // Admin chose not to settle: the swap is quoted at the current line price, so no refund or
    // payment request is raised and the order total does not move.
    const waivedDiff = settlePayment ? 0 : listPreview.priceDiff
    const preview = settlePayment
      ? listPreview
      : { ...listPreview, newUnitPrice: listPreview.oldUnitPrice, priceDiff: 0, settlementType: 'none' as const }

    // Settlement type: COD orders adjust the total on delivery; online orders refund/collect.
    const isCod = order.payment_mode === 'cod' || order.payment_status?.startsWith('cod')
    const settlementType = preview.settlementType === 'none'
      ? 'none'
      : (isCod ? 'cod_adjust' : preview.settlementType)

    const vcr = await queryOne<{ id: string }>(
      `INSERT INTO variant_change_requests
         (order_id, order_item_id, requested_by_admin_id, old_variant_id, old_sub_variant_id,
          new_variant_id, new_sub_variant_id, old_variant_name, new_variant_name,
          old_unit_price, new_unit_price, qty, price_diff,
          settlement_type, status, admin_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending_customer',$15)
       RETURNING id`,
      [
        orderId, orderItemId, admin.adminId, item.variant_id, item.sub_variant_id,
        newVariantId ?? null, newSubVariantId ?? null, item.variant_name ?? null, newV.name ?? null,
        preview.oldUnitPrice, preview.newUnitPrice, qty, preview.priceDiff,
        settlementType, adminNotes ?? null,
      ]
    )

    // Notify the customer: email always + preferred SMS/WhatsApp with the order link.
    const orderUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/account/orders/${orderId}`
    const custEmail = order.user_email || order.customer_email
    const custName = order.first_name ? `${order.first_name} ${order.last_name || ''}`.trim() : (order.customer_name || 'Customer')
    if (custEmail) {
      sendVariantChangeRequestedEmail({
        customerEmail: custEmail,
        customerName: custName,
        orderNumber: order.order_number,
        orderId,
        oldVariantName: item.variant_name ?? null,
        newVariantName: newV.name,
        priceDiff: preview.priceDiff,
        settlementType,
        newTotal: 0,
      }).catch(() => {})
    }
    notifyVariantChangeRequested(order.user_id, order.order_number, orderUrl).catch(() => {})

    if (order.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'variant_change',
        referenceId: orderId,
        referenceType: 'orders',
        summary: waivedDiff !== 0
          ? `Variant change requested on #${order.order_number} (no payment — ₹${Math.abs(waivedDiff).toFixed(2)} difference waived)`
          : `Variant change requested on #${order.order_number} (${settlementType}, ₹${Math.abs(preview.priceDiff).toFixed(2)})`,
        metadata: { vcrId: vcr?.id, settlement: settlementType, priceDiff: preview.priceDiff, waivedDiff },
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, requestId: vcr?.id, preview: { ...preview, settlementType } })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create variant change request' }, { status: 500 })
  }
}
