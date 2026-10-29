import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { previewAdjustment, createAdjustment, AdjustmentError } from '@/lib/orders/adjustments'
import { notifyVariantChangeRequested } from '@/lib/shared/notify'
import { sendOrderAdjustmentEmail } from '@/lib/email/lifecycle'
import { orderUrlById } from '@/lib/shared/customer-links'
import { logActivity } from '@/lib/shared/activity'
import { openReplyContextSafe } from '@/lib/replies/context'
import { withReplyContext } from '@/lib/replies/scope'

export const dynamic = 'force-dynamic'

// GET — this order's adjustments (with lines) plus legacy single-variant changes, newest first.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const [adjustments, legacy] = await Promise.all([
    queryMany<any>(
      `SELECT a.id, a.status, a.settlement_type, a.net_diff, a.new_total, a.settle_payment, a.admin_notes, a.created_at, a.applied_at, a.refund_status,
              COALESCE(json_agg(json_build_object('action', l.action, 'old', l.old_snapshot, 'new', l.new_line) ORDER BY l.created_at)
                FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
         FROM order_adjustments a LEFT JOIN order_adjustment_lines l ON l.adjustment_id = a.id
        WHERE a.order_id = $1 GROUP BY a.id ORDER BY a.created_at DESC`,
      [orderId]
    ),
    queryMany<any>(
      `SELECT vcr.id, vcr.status, vcr.settlement_type, vcr.price_diff AS net_diff, vcr.created_at, vcr.applied_at,
              CASE WHEN vcr.settlement_type = 'refund' AND vcr.status = 'applied' THEN (CASE WHEN vcr.refund_id IS NULL THEN 'pending' ELSE 'refunded' END) END AS refund_status,
              json_build_array(json_build_object('action', 'switch', 'old', json_build_object('name', vcr.old_variant_name),
                'new', json_build_object('productName', vcr.new_variant_name))) AS lines
         FROM variant_change_requests vcr WHERE vcr.order_id = $1 ORDER BY vcr.created_at DESC`,
      [orderId]
    ),
  ])
  const history = [...adjustments, ...legacy.map(l => ({ ...l, legacy: true }))].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  return NextResponse.json({ history })
}

const bodySchema = z.object({
  lines: z
    .array(
      z.object({
        orderItemId: zUuid,
        action: z.enum(['switch', 'remove', 'quantity']),
        productId: zUuid.optional(),
        variantId: zUuid.nullable().optional(),
        subVariantId: zUuid.nullable().optional(),
        unit: z.string().max(20).nullable().optional(),
        quantity: z.number().positive().max(100000).optional(),
      })
    )
    .min(1)
    .max(100),
  settlePayment: z.boolean().optional(),
  adminNotes: z.string().max(1000).nullable().optional(),
  dryRun: z.boolean().optional(),
})

// POST — preview (dryRun) or send a product adjustment to the customer for approval.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const parsed = parseBody(bodySchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { lines, adminNotes, dryRun } = parsed.data
  const settlePayment = parsed.data.settlePayment !== false
  try {
    if (dryRun) return NextResponse.json({ preview: await previewAdjustment(orderId, lines, settlePayment) })
    const { id, preview } = await createAdjustment({ orderId, lines, settlePayment, adminId: admin.adminId, adminNotes })

    const order = await queryOne<any>(
      `SELECT o.order_number, o.user_id, o.customer_email, o.customer_name, u.email AS user_email, u.first_name, u.last_name,
              COALESCE(NULLIF(u.phone, ''), o.customer_phone) AS phone
         FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId]
    )
    const email = order?.user_email || order?.customer_email
    // The customer can answer by replying to the email or WhatsApp; the reply comes back to this.
    const reply = order ? await openReplyContextSafe({ scenario: 'order_adjustment', entityType: 'orders', entityId: orderId, refId: id, userId: order.user_id, email, phone: order.phone }) : null
    const scope = reply && { contextId: reply.context.id, replyTo: reply.replyTo, entityType: 'orders', entityId: orderId }
    await withReplyContext(scope, async () => {
      if (email) {
        sendOrderAdjustmentEmail({
          customerEmail: email,
          customerName: order.first_name ? `${order.first_name} ${order.last_name || ''}`.trim() : order.customer_name || 'Customer',
          orderNumber: order.order_number,
          orderId,
          changes: preview.lines.map(l => ({
            action: l.action,
            from: `${l.old.name} × ${l.old.quantity}${l.old.unit ? ` ${l.old.unit}` : ''}`,
            to: l.new ? `${l.new.productName} × ${l.new.quantity}${l.new.unit ? ` ${l.new.unit}` : ''}` : null,
          })),
          netDiff: preview.netDiff,
          settlementType: preview.settlementType,
          newTotal: preview.newTotal,
        }).catch(() => {})
      }
      if (order) notifyVariantChangeRequested(order.user_id, order.order_number, await orderUrlById(orderId)).catch(() => {})
    })
    if (order?.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'order_adjustment',
        referenceId: orderId,
        referenceType: 'orders',
        summary: `Product adjustment requested on #${order.order_number} (${preview.settlementType} ₹${Math.abs(preview.netDiff).toFixed(2)})`,
        metadata: { adjustmentId: id, netDiff: preview.netDiff },
      }).catch(() => {})
    }
    return NextResponse.json({ id, preview })
  } catch (e: any) {
    if (e instanceof AdjustmentError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e?.message || 'Failed to create the adjustment' }, { status: 500 })
  }
}
