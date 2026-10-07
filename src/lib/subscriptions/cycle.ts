import 'server-only'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { calculateGST, isInterState, round2 } from '@/lib/catalog/gst'
import { getBusinessValues, getFeatureFlags } from '@/lib/catalog/site-controls'
import { computeEdd } from '@/lib/shipping/edd'
import { grantOrderEntitlements } from '@/lib/orders/entitlements'
import { afterOrderCommitted } from '@/lib/orders/after-commit'
import { createDraftInvoice, generateOrderInvoice } from '@/lib/documents/invoice'
import { notifyAccessGranted } from '@/lib/shared/notify'
import { transferToLinkedAccount, recordTenantTransaction } from '@/lib/payments/razorpay-route'
import { controlPlanePool } from '@/lib/tenant-registry'
import {
  sendSubscriptionStartedEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
} from '@/lib/email/subscription'
import type { SubscriptionRow } from './types'

export const NIL_TENANT_ID = '00000000-0000-0000-0000-000000000000'
export const ACCESS_GRACE_MS = 3 * 24 * 60 * 60 * 1000

const TERMINAL = new Set(['cancelled', 'completed', 'expired'])

const EVENT_STATUS: Record<string, string | null> = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.resumed': 'active',
  'subscription.pending': 'pending',
  'subscription.halted': 'halted',
  'subscription.paused': 'paused',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
  'subscription.updated': null,
}

export function isSubscriptionEvent(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_STATUS, eventType)
}

export function statusForEvent(eventType: string): string | null {
  return EVENT_STATUS[eventType] ?? null
}

/** Out-of-order safe: a terminal sub never moves again, and 'authenticated' only follows 'created'. */
export function nextStatus(current: string, target: string | null): string {
  if (!target || TERMINAL.has(current)) return current
  if (target === 'authenticated' && current !== 'created') return current
  if (target === 'created') return current
  return target
}

export function unixToDate(v: unknown): Date | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null
}

function laterOf(a: Date | null, b: string | Date | null | undefined): Date | null {
  const bd = b ? new Date(b) : null
  if (!a) return bd
  if (!bd) return a
  return a.getTime() >= bd.getTime() ? a : bd
}

export interface TenantRef {
  tenantId: string
  slug: string
}

export interface CommitCycleInput {
  subscriptionId: string
  paymentId: string
  invoiceId?: string | null
  gatewayOrderId?: string | null
  amountPaise: number
  /** Razorpay subscription entity paid_count. */
  paidCount?: number | null
  currentStart?: Date | null
  currentEnd?: Date | null
  tenant?: TenantRef | null
}

export interface CommitCycleResult {
  created: boolean
  orderId: string | null
  orderNumber: string | null
  cycle: number | null
}

/**
 * Mint the order for one paid cycle. razorpay_payment_id is the sole idempotency key: the ledger
 * INSERT ... ON CONFLICT runs in the same txn as the order insert (and under a row lock on the
 * subscription), so verify + webhook racing on one payment commit exactly one order.
 */
export async function commitCycle(input: CommitCycleInput): Promise<CommitCycleResult> {
  const flags = await getFeatureFlags()
  const bv = await getBusinessValues()

  const out = await withTransaction(async client => {
    const subRes = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`, [
      input.subscriptionId,
    ])
    const sub = subRes.rows[0]
    if (!sub) throw new Error('Subscription not found')

    const seen = await client.query<{ order_id: string | null; cycle_number: number; order_number: string | null }>(
      `SELECT sco.order_id, sco.cycle_number, o.order_number
         FROM subscription_cycle_orders sco LEFT JOIN orders o ON o.id = sco.order_id
        WHERE sco.razorpay_payment_id = $1`,
      [input.paymentId]
    )
    if (seen.rows[0]) {
      const r = seen.rows[0]
      return { created: false, orderId: r.order_id, orderNumber: r.order_number, cycle: r.cycle_number, sub, order: null }
    }

    const maxRes = await client.query<{ max: number | null }>(
      `SELECT MAX(cycle_number) AS max FROM subscription_cycle_orders WHERE subscription_id = $1`,
      [sub.id]
    )
    const maxCycle = Number(maxRes.rows[0]?.max ?? 0)
    const paid = Number(input.paidCount ?? 0)
    // paid_count is authoritative; fall forward past a taken number rather than lose a paid cycle.
    const cycle = paid > maxCycle ? paid : maxCycle + 1

    const ledger = await client.query<{ id: string }>(
      `INSERT INTO subscription_cycle_orders (subscription_id, cycle_number, razorpay_payment_id, razorpay_invoice_id, amount_paise, status)
       VALUES ($1, $2, $3, $4, $5, 'committed')
       ON CONFLICT (razorpay_payment_id) DO NOTHING
       RETURNING id`,
      [sub.id, cycle, input.paymentId, input.invoiceId ?? null, input.amountPaise]
    )
    if (!ledger.rows[0]) return { created: false, orderId: null, orderNumber: null, cycle, sub, order: null }

    const userRes = await client.query(`SELECT * FROM users WHERE id = $1`, [sub.user_id])
    const user = userRes.rows[0]
    if (!user) throw new Error('Subscription user not found')

    const prodRes = await client.query(
      `SELECT p.name, p.sku, p.mrp, p.handling_days, p.extra_delivery_days,
              pv.variant_name, pv.sku AS variant_sku, pv.mrp AS variant_mrp,
              psv.sub_variant_name, psv.sku AS sub_variant_sku, psv.mrp AS sub_variant_mrp
         FROM products p
         LEFT JOIN product_variants pv ON pv.id = $2
         LEFT JOIN product_sub_variants psv ON psv.id = $3
        WHERE p.id = $1`,
      [sub.product_id, sub.variant_id, sub.sub_variant_id]
    )
    const p = prodRes.rows[0] ?? {}

    const address = sub.address_snapshot ?? {}
    const isDigital = sub.is_digital === true
    const qty = Math.max(1, Math.round(Number(sub.quantity ?? 1)))
    const unitPrice = round2(Number(sub.unit_price_paise ?? 0) / 100)
    const itemTotal = round2(unitPrice * qty)
    const shipping = isDigital ? 0 : round2(Number(sub.shipping_paise ?? 0) / 100)
    const total = round2(itemTotal + shipping)
    const gstRate = Number(sub.gst_rate ?? 0)
    const isIGST = flags.gstEnabled ? isInterState(String(address.state ?? ''), bv.businessStateCode) : false
    const gst = flags.gstEnabled ? calculateGST(itemTotal, gstRate, isIGST) : null

    const productName = p.sub_variant_name
      ? `${p.name}${p.variant_name ? ' - ' + p.variant_name : ''} - ${p.sub_variant_name}`
      : p.variant_name
        ? `${p.name} - ${p.variant_name}`
        : (p.name ?? 'Subscription item')
    const variantName = p.sub_variant_name
      ? `${p.variant_name ? p.variant_name + ' / ' : ''}${p.sub_variant_name}`
      : (p.variant_name ?? null)
    const mrpRaw = p.sub_variant_mrp ?? p.variant_mrp ?? p.mrp
    const mrp = mrpRaw != null ? Number(mrpRaw) : null

    const estimatedDeliveryDate = isDigital
      ? null
      : computeEdd({
          pin: String(address.postal_code ?? ''),
          originPin: bv.delhiveryOriginPincode,
          handlingDays: Number(p.handling_days ?? 2),
          extraDays: Number(p.extra_delivery_days ?? 0),
        })

    const isGranted = isDigital
    const status = isGranted ? 'granted' : 'confirmed'
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    const customerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
    const snapshot = JSON.stringify(address)

    const orderRes = await client.query<{ id: string; order_number: string; total_amount: string; status: string }>(
      `INSERT INTO orders (
        order_number, user_id, customer_email, customer_phone, customer_name,
        status, payment_status, subtotal, discount_amount, business_discount_amount,
        tax_amount, shipping_amount, total_amount,
        shipping_address_id, billing_address_id, notes,
        taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
        order_type, shipping_address_snapshot, billing_address_snapshot,
        estimated_delivery_date, cod_fee_amount, subscription_id, subscription_cycle,
        confirmed_at, delivered_at, granted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7, 0, 0, $8, $9, $10, $11, $11, $12, $13, $14, $15, $16, $17,
        'direct', $18, $18, $19, 0, $20, $21,
        CASE WHEN $22::boolean THEN NOW() END, CASE WHEN $22::boolean THEN NOW() END, CASE WHEN $22::boolean THEN NOW() END)
      RETURNING id, order_number, total_amount, status`,
      [
        orderNumber,
        sub.user_id,
        user.email,
        user.phone ?? null,
        customerName,
        status,
        itemTotal,
        gst ? gst.totalTax : 0,
        shipping,
        total,
        sub.address_id,
        `Subscription cycle ${cycle}`,
        gst ? gst.taxableAmount : 0,
        gst ? gst.cgst : 0,
        gst ? gst.sgst : 0,
        gst ? gst.igst : 0,
        isIGST,
        snapshot,
        estimatedDeliveryDate,
        sub.id,
        cycle,
        isGranted,
      ]
    )
    const order = orderRes.rows[0]

    await client.query(
      `INSERT INTO order_items (
        order_id, product_id, variant_id, sub_variant_id, product_name, product_sku, variant_name,
        quantity, unit_price, total_price, tax_amount, hsn_code, gst_rate,
        taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit, mrp,
        is_digital, is_returnable
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'unit', NULL, $18, $19, $20)`,
      [
        order.id,
        sub.product_id,
        sub.variant_id,
        sub.sub_variant_id,
        productName,
        p.sub_variant_sku || p.variant_sku || p.sku || null,
        variantName,
        qty,
        unitPrice,
        itemTotal,
        gst ? gst.totalTax : 0,
        flags.gstEnabled ? sub.hsn_code : null,
        flags.gstEnabled ? gstRate : null,
        gst ? gst.taxableAmount : 0,
        gst ? gst.cgst : 0,
        gst ? gst.sgst : 0,
        gst ? gst.igst : 0,
        mrp,
        isDigital,
        !isDigital,
      ]
    )

    await client.query(
      `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'completed', $4)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        order.id,
        input.paymentId,
        (input.amountPaise / 100).toFixed(2),
        JSON.stringify({
          razorpay_order_id: input.gatewayOrderId ?? null,
          razorpay_payment_id: input.paymentId,
          razorpay_subscription_id: sub.razorpay_subscription_id,
          razorpay_invoice_id: input.invoiceId ?? null,
        }),
      ]
    )

    await client.query(`UPDATE subscription_cycle_orders SET order_id = $1 WHERE id = $2`, [order.id, ledger.rows[0].id])

    const currentEnd = laterOf(input.currentEnd ?? null, sub.current_end)
    const currentStart = laterOf(input.currentStart ?? null, sub.current_start)
    const accessExpiresAt = isDigital && currentEnd ? new Date(currentEnd.getTime() + ACCESS_GRACE_MS) : null
    if (isDigital) {
      await grantOrderEntitlements(client, {
        orderId: order.id,
        userId: sub.user_id,
        source: 'subscription',
        subscriptionId: sub.id,
        accessExpiresAt,
      })
    }

    await client.query(
      `UPDATE subscriptions SET
         current_cycle = GREATEST(COALESCE(current_cycle, 0), $2),
         current_start = COALESCE($3, current_start),
         current_end = COALESCE($4, current_end),
         next_renewal_at = COALESCE($4, next_renewal_at),
         access_expires_at = COALESCE($5, access_expires_at),
         last_renewed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [sub.id, cycle, currentStart, currentEnd, accessExpiresAt]
    )

    return { created: true, orderId: order.id, orderNumber: order.order_number, cycle, sub, order, user }
  })

  if (out.created && out.order) {
    const order = out.order
    const sub = out.sub
    const draft = createDraftInvoice(order.id).catch(() => {})
    if (order.status === 'granted') {
      draft.then(() => generateOrderInvoice(order.id)).catch(() => {})
      notifyAccessGranted(sub.user_id, order.order_number).catch(() => {})
    }
    afterOrderCommitted({
      userId: sub.user_id,
      order,
      user: (out as any).user ?? null,
      routeTransfer: () =>
        fireCycleTransfer({
          tenant: input.tenant ?? null,
          sub,
          paymentId: input.paymentId,
          totalInr: input.amountPaise / 100,
          orderId: order.id,
          orderRef: order.order_number,
        }),
      activitySummary: `Subscription cycle ${out.cycle} — order #${order.order_number}`,
      activityMetadata: { subscriptionId: sub.id, cycle: out.cycle },
    }).catch(() => {})
    if (out.cycle === 1) sendSubscriptionStartedEmail(sub.id).catch(() => {})
  }

  return { created: out.created, orderId: out.orderId, orderNumber: out.orderNumber, cycle: out.cycle }
}

/** Route split for platform-collect tenants with a linked account; otherwise just record the sale. */
export async function fireCycleTransfer(opts: {
  tenant: TenantRef | null
  sub: Pick<SubscriptionRow, 'collecting_account' | 'linked_account_id'>
  paymentId: string
  totalInr: number
  orderId: string
  orderRef: string
}): Promise<void> {
  const t = opts.tenant
  if (!t?.tenantId || t.tenantId === NIL_TENANT_ID) return

  if (opts.sub.collecting_account !== 'platform' || !opts.sub.linked_account_id) {
    await recordTenantTransaction({
      tenantId: t.tenantId,
      orderRef: opts.orderRef,
      grossAmountInr: opts.totalInr,
      gatewayTxnId: opts.paymentId,
    })
    return
  }

  const row = await controlPlanePool()
    .query(`SELECT daily_payout FROM tenants WHERE id = $1 AND status = 'active'`, [t.tenantId])
    .catch(() => null)
  if (!row?.rows[0]) return
  const result = await transferToLinkedAccount({
    paymentId: opts.paymentId,
    grossAmountPaise: Math.round(opts.totalInr * 100),
    linkedAccountId: opts.sub.linked_account_id,
    orderId: opts.orderId,
    tenantSlug: t.slug,
    dailyPayout: row.rows[0].daily_payout === true,
  })
  await recordTenantTransaction({
    tenantId: t.tenantId,
    orderRef: opts.orderRef,
    grossAmountInr: opts.totalInr,
    gatewayTxnId: result.transferId || opts.paymentId,
    split: {
      tenantShareInr: result.amount / 100,
      platformCommissionInr: result.platformCommissionPaise / 100,
      gatewayFeeInr: (result.gatewayFeePaise + result.transferFeePaise) / 100,
    },
  })
}

/**
 * Apply a Razorpay subscription entity to the local row. `target` is the status implied by the
 * event (or the entity status on a sync); nextStatus() keeps it out-of-order safe. Period dates
 * only move forward. Halt/cancel/complete/expire cap access at the current period end.
 */
export async function applySubscriptionState(
  localId: string,
  target: string | null,
  entity: any
): Promise<{ row: SubscriptionRow; prevStatus: string; changed: boolean }> {
  const res = await withTransaction(async client => {
    const cur = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`, [localId])
    const row = cur.rows[0]
    if (!row) throw new Error('Subscription not found')

    const status = nextStatus(row.status, target)
    const currentStart = laterOf(unixToDate(entity?.current_start), row.current_start)
    const currentEnd = laterOf(unixToDate(entity?.current_end), row.current_end)
    const paid = Number(entity?.paid_count ?? 0)
    const caps = status !== row.status && ['halted', 'cancelled', 'completed', 'expired'].includes(status)

    const upd = await client.query<SubscriptionRow>(
      `UPDATE subscriptions SET
         status = $2::text,
         current_start = $3,
         current_end = $4,
         current_cycle = GREATEST(COALESCE(current_cycle, 0), $5),
         next_renewal_at = COALESCE($4, next_renewal_at),
         paused_at = CASE WHEN $2::text = 'paused' THEN COALESCE(paused_at, NOW()) WHEN $2::text = 'active' THEN NULL ELSE paused_at END,
         cancelled_at = CASE WHEN $2::text = 'cancelled' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END,
         access_expires_at = CASE WHEN $6::boolean THEN $4 ELSE access_expires_at END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [localId, status, currentStart, currentEnd, Number.isFinite(paid) ? paid : 0, caps]
    )
    if (caps && currentEnd) {
      await client.query(
        `UPDATE vault_entitlements SET access_expires_at = LEAST(COALESCE(access_expires_at, $2), $2), updated_at = NOW()
          WHERE subscription_id = $1 AND status = 'active'`,
        [localId, currentEnd]
      )
    }
    return { row: upd.rows[0], prevStatus: row.status, changed: status !== row.status }
  })

  if (res.changed) {
    if (res.row.status === 'halted') sendSubscriptionPaymentFailedEmail(localId).catch(() => {})
    if (res.row.status === 'cancelled') sendSubscriptionCancelledEmail(localId).catch(() => {})
  }
  return res
}

/**
 * Webhook entry point (both endpoints). Caller must already be inside the tenant's context. Returns
 * false when the subscription is unknown in this tenant DB (ack-and-drop). DB errors propagate so
 * the caller can map them to a retryable 5xx.
 */
export async function processSubscriptionEvent(eventType: string, event: any, tenant: TenantRef | null): Promise<boolean> {
  const entity = event?.payload?.subscription?.entity
  const rzpId = (entity?.id ?? '').toString().trim()
  if (!rzpId) return false
  const local = await queryOne<{ id: string }>(`SELECT id FROM subscriptions WHERE razorpay_subscription_id = $1`, [rzpId])
  if (!local) return false

  const payment = event?.payload?.payment?.entity
  if (payment?.id && payment.status === 'captured') {
    await commitCycle({
      subscriptionId: local.id,
      paymentId: String(payment.id),
      invoiceId: payment.invoice_id ?? null,
      gatewayOrderId: payment.order_id ?? null,
      amountPaise: Number(payment.amount) || 0,
      paidCount: Number(entity.paid_count) || null,
      currentStart: unixToDate(entity.current_start),
      currentEnd: unixToDate(entity.current_end),
      tenant,
    })
  }

  await applySubscriptionState(local.id, statusForEvent(eventType), entity)
  return true
}
