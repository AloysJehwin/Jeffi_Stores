import { queryOne, queryMany } from '@/lib/shared/db'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import {
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_ALLOWED_FOR_STATUS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_TRANSITIONS,
  manualPaymentStatusError,
  orderLockedError,
  orderTransitionError,
  paymentStatusError,
} from '@/lib/orders/status-flow'
import { computeRefundableAmount, externalRefundCeiling, refundCapacity } from '@/lib/payments/refund'
import {
  EXTERNAL_REFUND_METHODS,
  RAZORPAY_ONLY_METHODS,
  externalRefundLabel,
  parseExternalRefund,
  type ExternalRefundMethod,
} from '@/lib/payments/external-refund'
import type { ToolDef } from '../tools'
import type { AgentActor } from '../permissions'
import { err } from '../tool-envelope'

// Order, payment and refund tools. Each proposal is checked against the rules of the endpoint its
// action executes through (PATCH /api/orders/[id], the refund and cancel routes), and that endpoint
// re-checks everything with the approving admin's own session.

const NIL = '00000000-0000-0000-0000-000000000000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OWNER_ONLY = 'Administrator or super admin only'
const PAYMENT_MODES = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'razorpay']
const SHIPPING_STATES = ['processing', 'shipped', 'out_for_delivery', 'delivered']
const MONEY_IN = ['paid', 'cod_collected']

const money = (n: number | string | null | undefined) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const flag = (v: unknown) => v === true || v === 'true'
const isOwner = (actor?: AgentActor) => !!actor && isPlatformOwner(actor.role)
const roleName = (actor?: AgentActor) => (actor?.role ? actor.role.replace(/_/g, ' ') : 'unknown')

interface OrderRow {
  id: string
  order_number: string
  status: string
  payment_status: string
  total_amount: string
  source: string | null
  invoice_number: string | null
  awb_number: string | null
  original_order_id: string | null
  payment_link_id: string | null
  razorpay_qr_id: string | null
  customer_name: string | null
  customer_email: string | null
  all_digital: boolean | null
}

async function findOrder(input: Record<string, unknown>): Promise<OrderRow | null> {
  const rawId = str(input.orderId) || str(input.invoiceId)
  const loose = rawId && !UUID_RE.test(rawId) ? rawId : ''
  const number = str(input.orderNumber) || loose
  const invoice = str(input.invoiceNumber) || loose
  if (!rawId && !number && !invoice) throw new Error('Provide orderId or orderNumber')
  return queryOne<OrderRow>(
    `SELECT o.id::text, o.order_number, o.status, o.payment_status, o.total_amount::text, o.source,
            o.invoice_number, o.awb_number, o.original_order_id::text, o.payment_link_id, o.razorpay_qr_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), o.customer_name) AS customer_name,
            COALESCE(u.email, o.customer_email) AS customer_email,
            (SELECT bool_and(oi.is_digital IS TRUE) FROM order_items oi WHERE oi.order_id = o.id) AS all_digital
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE (o.id = $1::uuid OR o.order_number = $2 OR ($3 <> '' AND o.invoice_number = $3)) AND o.status <> 'draft'
      LIMIT 1`,
    [UUID_RE.test(rawId) ? rawId : NIL, number, invoice]
  )
}

function subject(o: OrderRow) {
  const meta = [o.customer_name, money(o.total_amount), o.invoice_number ? `Invoice ${o.invoice_number}` : null]
    .filter(Boolean)
    .join(' · ')
  return { label: `Order ${o.order_number}`, href: `/admin/orders/${o.id}/view`, meta: meta || null }
}

function changeSummary(
  title: string,
  o: OrderRow,
  changes: Array<{ field: string; from?: string | null; to: string; tone?: 'neutral' | 'success' | 'warn' | 'danger' }>,
  effects: string[],
  warnings: string[],
  requires: string | null = null
) {
  return {
    type: 'change_summary',
    title,
    subject: subject(o),
    changes,
    ...(effects.length ? { effects } : {}),
    ...(warnings.length ? { warnings } : {}),
    requires,
  }
}

const statusTone = (s: string) =>
  ['cancelled', 'cancel_rejected', 'return_rejected', 'failed', 'refunded'].includes(s)
    ? 'danger'
    : ['delivered', 'granted', 'paid', 'cod_collected', 'returned'].includes(s)
      ? 'success'
      : 'neutral'

const nextStatuses = (from: string) => ORDER_STATUS_TRANSITIONS[from] ?? []

function overrideHint(actor?: AgentActor): string {
  return isOwner(actor)
    ? 'As an administrator / super admin you can override this: pass override=true with an overrideReason (10–500 characters).'
    : `Overrides are ${OWNER_ONLY.toLowerCase()}; this user (${roleName(actor)}) can't override. Ask an owner if the change is really needed.`
}

/** The override inputs, or an error when this actor may not use them. */
function readOverride(input: Record<string, unknown>, actor?: AgentActor): { override: boolean; reason: string } | string {
  const override = flag(input.override)
  const reason = str(input.overrideReason)
  if (!override) return { override: false, reason: '' }
  if (!isOwner(actor)) {
    return `This user's role (${roleName(actor)}) can't override order or payment status rules — ${OWNER_ONLY.toLowerCase()}. Propose a normal change instead.`
  }
  if (reason.length < 10 || reason.length > 500) return 'An override needs an overrideReason of 10–500 characters (it goes in the audit log).'
  return { override: true, reason }
}

async function inventoryEnabled(): Promise<boolean> {
  try {
    const { getFeatureFlags } = await import('@/lib/catalog/site-controls')
    return (await getFeatureFlags()).inventoryValidationEnabled
  } catch {
    return true
  }
}

/** Units the order took from stock and has not given back (what a cancel restores). */
async function unitsToRestore(orderId: string): Promise<number> {
  const r = await queryOne<{ sold: number; back: number }>(
    `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN -quantity_change ELSE 0 END), 0)::float AS sold,
            COALESCE(SUM(CASE WHEN transaction_type = 'return' THEN quantity_change ELSE 0 END), 0)::float AS back
       FROM inventory_transactions WHERE reference_type = 'order' AND reference_id = $1::uuid`,
    [orderId]
  ).catch(() => null)
  return Math.max(0, Math.round(((r?.sold ?? 0) - (r?.back ?? 0)) * 1000) / 1000)
}

interface Plan {
  changes: Array<{ field: string; from?: string | null; to: string; tone?: 'neutral' | 'success' | 'warn' | 'danger' }>
  effects: string[]
  warnings: string[]
}

/**
 * Validates a status / payment-status change the way PATCH /api/orders/[id] will, and lists what
 * that endpoint does as a result. Returns an error string when the change can't be proposed.
 */
async function planStatusChange(
  o: OrderRow,
  want: { status?: string; paymentStatus?: string; awb?: string | null; override: boolean; reason: string },
  actor?: AgentActor
): Promise<Plan | string> {
  const status = want.status && want.status !== o.status ? want.status : null
  const payment = want.paymentStatus && want.paymentStatus !== o.payment_status ? want.paymentStatus : null
  const plan: Plan = { changes: [], effects: [], warnings: [] }

  if (want.override) {
    if (status && !ORDER_STATUSES.includes(status)) return `Unknown order status: ${status}`
    if (payment) {
      const e = paymentStatusError(o.payment_status, payment, true)
      if (e) return e
    }
    plan.warnings.push('Override: skips the normal status rules. Recorded in the audit log with your reason.')
    if (payment === 'refunded') {
      plan.warnings.push('Setting "refunded" moves no money and records no refund. To actually refund, use a refund instead.')
    }
  } else {
    const locked = orderLockedError(o.status)
    if (locked) return `${locked}. ${overrideHint(actor)}`
    if (status) {
      const e = orderTransitionError(o.status, status)
      if (e) {
        const next = nextStatuses(o.status)
        return `${e}. From '${o.status}' it can move to: ${next.join(', ') || 'nothing (final status)'}. ${overrideHint(actor)}`
      }
      if (o.all_digital && SHIPPING_STATES.includes(status)) {
        return `Order ${o.order_number} is digital — access is granted on payment and it has no shipping states.`
      }
    }
    if (payment) {
      const e = manualPaymentStatusError(o.payment_status, payment, false)
      if (e) {
        const next = (PAYMENT_STATUS_TRANSITIONS[o.payment_status] ?? []).filter(s => s !== 'refunded')
        return payment === 'refunded'
          ? `${e} Call get_order_refund_options, then propose_refund_order.`
          : `${e}. From '${o.payment_status}' payment can move to: ${next.join(', ') || 'nothing'}. ${overrideHint(actor)}`
      }
    }
    const effective = status || o.status
    const fits = PAYMENT_ALLOWED_FOR_STATUS[effective]
    if (fits && payment && !fits.includes(payment)) {
      return `Payment status '${payment}' doesn't fit an order that is '${effective}'. It can be: ${fits.join(', ')}.`
    }
    if (fits && !payment && status && !fits.includes(o.payment_status)) {
      plan.warnings.push(
        `Payment is '${label(o.payment_status)}', which doesn't usually fit '${label(status)}' (expected ${fits.map(label).join(' / ')}).`
      )
    }
    if (status === 'processing') {
      const { hasPendingAddressChange } = await import('@/lib/orders/address-change')
      if (await hasPendingAddressChange(o.id)) {
        return 'The customer has a pending delivery address change on this order. Approve or reject it on the order page before moving it to processing.'
      }
    }
  }

  if (status) plan.changes.push({ field: 'Order status', from: label(o.status), to: label(status), tone: statusTone(status) })
  if (payment) plan.changes.push({ field: 'Payment status', from: label(o.payment_status), to: label(payment), tone: statusTone(payment) })
  if (!status && !payment) return `Order ${o.order_number} is already ${label(o.status)} / ${label(o.payment_status)} — nothing to change.`

  const inventory = status === 'processing' || status === 'cancelled' ? await inventoryEnabled() : false
  if (status === 'processing' && inventory) {
    const lines = await queryOne<{ lines: number; serialized: boolean | null; perishable: boolean | null }>(
      `SELECT COUNT(*)::int AS lines, bool_or(p.serialized) AS serialized, bool_or(p.perishable) AS perishable
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1::uuid AND oi.is_digital = FALSE`,
      [o.id]
    )
    // The endpoint requires the serial numbers for these even on an override.
    if (lines?.serialized) {
      return 'This order has serial-numbered items. Move it to processing from the order page so the serial numbers can be entered.'
    }
    plan.effects.push(
      `Checks and deducts stock for ${lines?.lines ?? 0} line(s)${lines?.perishable ? ' (batches picked first-expiry-first)' : ''}; fails if stock is short`
    )
    plan.effects.push('Numbers the invoice')
  }
  if (status === 'cancelled') {
    const units = inventory ? await unitsToRestore(o.id) : 0
    if (units > 0) plan.effects.push(`Restores ${units} unit(s) to stock`)
    if (o.awb_number) plan.effects.push(`Cancels the Delhivery shipment (AWB ${o.awb_number})`)
    if (MONEY_IN.includes(payment || o.payment_status)) {
      plan.warnings.push(
        `${money(o.total_amount)} was collected and stays ${label(payment || o.payment_status)} — cancelling doesn't refund it. Refund it afterwards with propose_refund_order.`
      )
    }
  }
  if (status === 'shipped' && want.awb) plan.effects.push(`Saves AWB ${want.awb} on the order`)
  if (status === 'shipped' && !want.awb && !o.awb_number) plan.warnings.push('No AWB number — the customer gets no tracking link.')
  if (status === 'delivered' && (o.payment_status === 'cod_pending' || payment === 'cod_pending')) {
    plan.effects.push('Creates a task to confirm the COD cash was collected')
  }
  if (o.customer_email) {
    if (status) plan.effects.push(`Emails ${o.customer_email} the new order status (and SMS/WhatsApp if they opted in)`)
    if (payment) plan.effects.push(`Emails ${o.customer_email} the new payment status`)
  }
  if (payment === 'failed') plan.effects.push('Creates a follow-up task for the failed payment')
  return plan
}

function proposal(kind: string, payload: Record<string, unknown>, confirmation: string, block: Record<string, unknown>) {
  return { proposed: true, kind, payload, confirmation, ui_blocks: [block] }
}

async function proposeStatus(
  input: Record<string, unknown>,
  actor: AgentActor | undefined,
  newStatus: string,
  kind: 'update_order_status' | 'mark_order_shipped' | 'cancel_order',
  extraPayload: Record<string, unknown> = {},
  loaded?: OrderRow
) {
  const o = loaded ?? (await findOrder(input))
  if (!o) return err('Order not found.')
  const ov = readOverride(input, actor)
  if (typeof ov === 'string') return err(ov)
  const paymentStatus = str(input.paymentStatus).toLowerCase() || undefined
  const awb = str(input.awbNumber) || null
  if (awb && awb.length > 64) return err('awbNumber is too long (max 64).')
  if (awb && newStatus !== 'shipped') return err('awbNumber only applies when the new status is shipped.')

  const plan = await planStatusChange(o, { status: newStatus, paymentStatus, awb, ...ov }, actor)
  if (typeof plan === 'string') return err(plan)

  const title = kind === 'cancel_order' ? 'Cancel order' : `Order ${label(o.status)} → ${label(newStatus)}`
  return proposal(
    kind,
    {
      orderId: o.id,
      orderNumber: o.order_number,
      source: o.source,
      fromStatus: o.status,
      newStatus,
      fromPaymentStatus: o.payment_status,
      paymentStatus: paymentStatus && paymentStatus !== o.payment_status ? paymentStatus : null,
      awbNumber: awb,
      override: ov.override,
      overrideReason: ov.override ? ov.reason : null,
      ...extraPayload,
    },
    `${ov.override ? 'Override: ' : ''}Move order ${o.order_number} from ${label(o.status)} to ${label(newStatus)}${
      paymentStatus && paymentStatus !== o.payment_status ? ` (payment ${label(o.payment_status)} → ${label(paymentStatus)})` : ''
    }${awb ? ` with AWB ${awb}` : ''}?`,
    changeSummary(title, o, plan.changes, plan.effects, plan.warnings, ov.override ? OWNER_ONLY : null)
  )
}

const OVERRIDE_PROPS = {
  override: {
    type: 'boolean',
    description: 'Administrator / super admin only: skip the normal status rules. Needs overrideReason. Only when the user asks to force it.',
  },
  overrideReason: { type: 'string', description: 'Why the override is needed (10–500 characters). Goes in the audit log.' },
}

const propose_update_order_status: ToolDef = {
  name: 'propose_update_order_status',
  description:
    "Propose moving an order to a new status (and optionally its payment status), exactly as the order page does. Follows the store's status flow: pending → confirmed → processing → shipped → out_for_delivery → delivered, with cancel_requested / cancelled from pending, confirmed or processing (processing can only go to cancel_requested). The response says which statuses are allowed if the move isn't. Shows side effects (stock deduction/restore, emails, shipment cancellation). Overrides are for administrators / super admins only and need a reason. Never use this to mark a payment refunded — use propose_refund_order.",
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order UUID.' },
      orderNumber: { type: 'string', description: 'Alternative to orderId.' },
      newStatus: { type: 'string', description: ORDER_STATUSES.join(' | ') },
      paymentStatus: {
        type: 'string',
        description: `Optional new payment status in the same change: ${PAYMENT_STATUSES.filter(s => s !== 'refunded').join(' | ')}.`,
      },
      awbNumber: { type: 'string', description: 'Optional AWB to save; only when newStatus is shipped.' },
      ...OVERRIDE_PROPS,
    },
    required: ['newStatus'],
  },
  mutating: true,
  handler: async (input, actor) => {
    const status = str(input.newStatus).toLowerCase()
    if (!ORDER_STATUSES.includes(status)) return err(`newStatus must be one of: ${ORDER_STATUSES.join(', ')}`)
    return proposeStatus(input, actor, status, 'update_order_status')
  },
}

const mark_order_shipped: ToolDef = {
  name: 'mark_order_shipped',
  description:
    'Propose marking a processing order as shipped, optionally saving its AWB number. Runs through the same status rules and notifications as the order page. Admin must approve.',
  inputSchema: {
    type: 'object',
    properties: {
      orderNumber: { type: 'string' },
      orderId: { type: 'string', description: 'Alternative to orderNumber.' },
      awbNumber: { type: 'string', description: 'Optional Delhivery AWB' },
    },
    required: ['orderNumber'],
  },
  mutating: true,
  handler: async (input, actor) => {
    const o = await findOrder(input)
    if (!o) throw new Error(`Unknown order: ${str(input.orderNumber) || str(input.orderId)}`)
    if (['shipped', 'out_for_delivery', 'delivered'].includes(o.status)) {
      return { proposed: false, info: `Order ${o.order_number} is already ${label(o.status)}.` }
    }
    if (o.status === 'granted') {
      return { proposed: false, info: `Order ${o.order_number} is a digital order (access granted); it never ships.` }
    }
    return proposeStatus({ ...input, override: false }, actor, 'shipped', 'mark_order_shipped', {}, o)
  },
}

const propose_set_payment_status: ToolDef = {
  name: 'propose_set_payment_status',
  description:
    "Propose changing only an order's payment status, through the order page's update. Normal moves: pending/unpaid → paid or failed, failed → paid or pending, cod_pending → cod_collected or failed, cod_collected → paid. It never sets refunded: refunds go through get_order_refund_options + propose_refund_order. Any other move needs an administrator / super admin override with a reason.",
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order UUID.' },
      orderNumber: { type: 'string', description: 'Alternative to orderId.' },
      paymentStatus: { type: 'string', description: PAYMENT_STATUSES.join(' | ') },
      ...OVERRIDE_PROPS,
    },
    required: ['paymentStatus'],
  },
  mutating: true,
  handler: async (input, actor) => {
    const payment = str(input.paymentStatus).toLowerCase()
    if (!PAYMENT_STATUSES.includes(payment)) return err(`paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}`)
    const o = await findOrder(input)
    if (!o) return err('Order not found.')
    const ov = readOverride(input, actor)
    if (typeof ov === 'string') return err(ov)
    if (payment === 'refunded' && !ov.override) {
      return err(
        "Payment can't be set to refunded directly — the refund flow records how the money went back (and refunds it via Razorpay when it can).",
        undefined,
        `Call get_order_refund_options for ${o.order_number}, then propose_refund_order.${isOwner(actor) ? ' An owner can force the status with override=true, but that refunds nothing.' : ''}`
      )
    }
    const plan = await planStatusChange(o, { paymentStatus: payment, ...ov }, actor)
    if (typeof plan === 'string') return err(plan)
    return proposal(
      'set_payment_status',
      {
        orderId: o.id,
        orderNumber: o.order_number,
        fromPaymentStatus: o.payment_status,
        paymentStatus: payment,
        override: ov.override,
        overrideReason: ov.override ? ov.reason : null,
      },
      `${ov.override ? 'Override: ' : ''}Set payment for order ${o.order_number} from ${label(o.payment_status)} to ${label(payment)}?`,
      changeSummary('Change payment status', o, plan.changes, plan.effects, plan.warnings, ov.override ? OWNER_ONLY : null)
    )
  },
}

const propose_mark_invoice_paid: ToolDef = {
  name: 'propose_mark_invoice_paid',
  description:
    'Propose marking an invoice (an order with an invoice number) as paid, the way Finance → Receivables "Mark paid" does. Records the payment mode and date in the audit log. Admin must approve.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Order UUID for the invoice.' },
      invoiceNumber: { type: 'string', description: 'Alternative to invoiceId.' },
      orderNumber: { type: 'string', description: 'Alternative to invoiceId.' },
      paymentMode: { type: 'string', description: `One of: ${PAYMENT_MODES.join(', ')}` },
      paidAt: { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
    },
    required: ['paymentMode'],
  },
  mutating: true,
  handler: async input => {
    const mode = str(input.paymentMode).toLowerCase()
    if (!PAYMENT_MODES.includes(mode)) return err(`paymentMode must be one of: ${PAYMENT_MODES.join(', ')}`)
    const paidAt = str(input.paidAt)
    if (paidAt && !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return err('paidAt must be YYYY-MM-DD')
    if (!str(input.invoiceId) && !str(input.invoiceNumber) && !str(input.orderNumber)) {
      return err('Provide invoiceId or invoiceNumber')
    }
    const o = await findOrder(input)
    if (!o || !o.invoice_number) return err('Invoice not found.')
    if (o.payment_status === 'paid') return { proposed: false, info: `Invoice ${o.invoice_number} is already paid.` }
    const ruleError =
      orderLockedError(o.status) || manualPaymentStatusError(o.payment_status, 'paid', false, [...PAYMENT_STATUSES, 'partial'])
    if (ruleError) return err(`Invoice ${o.invoice_number} can't be marked paid: ${ruleError}`)

    const on = paidAt || new Date().toISOString().slice(0, 10)
    return proposal(
      'mark_invoice_paid',
      {
        orderId: o.id,
        invoiceNumber: o.invoice_number,
        paymentMode: mode,
        paidAt: paidAt || null,
        amount: Number(o.total_amount),
        customerName: o.customer_name || '',
      },
      `Mark invoice ${o.invoice_number} (${money(o.total_amount)}) as paid via ${label(mode)}?`,
      changeSummary(
        'Mark invoice paid',
        o,
        [
          { field: 'Payment status', from: label(o.payment_status), to: 'paid', tone: 'success' },
          { field: 'Payment', to: `${money(o.total_amount)} by ${label(mode)} on ${on}` },
        ],
        ['Removes the invoice from receivables', 'Records the payment mode and date in the audit log'],
        ['No receipt or payment record is created and the customer is not emailed.']
      )
    )
  },
}

const propose_cancel_order: ToolDef = {
  name: 'propose_cancel_order',
  description:
    "Propose cancelling an order the way the admin UI does. Offline invoices go through the invoice cancel (restores stock, voids any open payment link / QR). Online orders follow the status flow: pending, confirmed and cancel_requested orders can be cancelled; a processing order must go to cancel_requested first; shipped orders can't be cancelled (only an administrator / super admin override with a reason). Cancelling never refunds — propose_refund_order afterwards.",
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order UUID.' },
      orderNumber: { type: 'string', description: 'Alternative to orderId.' },
      reason: { type: 'string', description: 'Why it is being cancelled (kept with the action).' },
      ...OVERRIDE_PROPS,
    },
  },
  mutating: true,
  handler: async (input, actor) => {
    const o = await findOrder(input)
    if (!o) return err('Order not found.')
    if (o.status === 'cancelled') return { proposed: false, info: `Order ${o.order_number} is already cancelled.` }
    const reason = str(input.reason).slice(0, 500) || null
    if (o.source !== 'offline') return proposeStatus(input, actor, 'cancelled', 'cancel_order', { reason }, o)

    // Offline invoice: POST /api/admin/orders/[id]/cancel.
    const units = (await inventoryEnabled()) ? await unitsToRestore(o.id) : 0
    const effects = [
      ...(units > 0 ? [`Restores ${units} unit(s) to stock`] : []),
      ...(o.payment_link_id || o.razorpay_qr_id ? ['Voids the open payment link / QR so it can no longer be paid'] : []),
    ]
    const warnings = MONEY_IN.includes(o.payment_status)
      ? [`${money(o.total_amount)} was collected and stays ${label(o.payment_status)} — cancelling doesn't refund it. Refund it afterwards with propose_refund_order.`]
      : []
    const payAfter = MONEY_IN.includes(o.payment_status) || o.payment_status === 'refunded' ? o.payment_status : 'cancelled'
    return proposal(
      'cancel_order',
      { orderId: o.id, orderNumber: o.order_number, source: o.source, fromStatus: o.status, newStatus: 'cancelled', override: false, overrideReason: null, reason },
      `Cancel invoice ${o.invoice_number || o.order_number}?`,
      changeSummary(
        'Cancel invoice',
        o,
        [
          { field: 'Order status', from: label(o.status), to: 'cancelled', tone: 'danger' },
          ...(payAfter !== o.payment_status ? [{ field: 'Payment status', from: label(o.payment_status), to: label(payAfter), tone: 'danger' as const }] : []),
        ],
        effects,
        warnings
      )
    )
  },
}

// ─── Refunds ────────────────────────────────────────────────────────────────

interface RefundOptions {
  refundable: number
  razorpay: { available: boolean; amount: number; reason: string | null; payments: Array<{ transactionId: string; amount: number; capacity: number }> }
  external: { available: boolean; ceiling: number; defaultAmount: number; methods: ExternalRefundMethod[]; reason: string | null }
  changeRefunds: Array<{ adjustmentId: string; amount: number; legacy: boolean }>
  razorpayCapacity: number
}

/** What the refund route (and the adjustment refund route) will accept for this order. */
async function refundOptions(o: OrderRow): Promise<RefundOptions> {
  const { getReturnRequest } = await import('@/lib/queries')
  const { isRazorpayEnabled } = await import('@/lib/payments/razorpay')
  const paymentOrderId = o.original_order_id || o.id
  const returnRequest = o.status === 'returned' ? await getReturnRequest(o.id).catch(() => null) : null
  const refundable = await computeRefundableAmount(o, returnRequest)

  const rp = await queryMany<{ transaction_id: string | null; amount: string; gateway_response: unknown }>(
    `SELECT transaction_id, amount, gateway_response FROM payments
      WHERE order_id = $1::uuid AND payment_gateway = 'razorpay' AND status = 'completed'`,
    [paymentOrderId]
  )
  const payments = rp
    .filter(p => p.transaction_id)
    .map(p => ({ transactionId: p.transaction_id!, amount: Number(p.amount), capacity: refundCapacity(p) }))
  const razorpayCapacity = Math.round(payments.reduce((s, p) => s + p.capacity, 0) * 100) / 100
  const gateway = await isRazorpayEnabled().catch(() => false)

  const target = Math.min(razorpayCapacity, refundable)
  const razorpayReason =
    o.status !== 'cancelled' && o.status !== 'returned'
      ? 'Razorpay refunds are for cancelled or returned orders. For money already returned another way, record it with an external method.'
      : o.payment_status !== 'paid'
        ? `Payment is '${o.payment_status}', not paid.`
        : !gateway
          ? 'The payment gateway is not configured.'
          : payments.length === 0
            ? 'No captured Razorpay payment on this order (COD, cash or marked paid by hand) — record the refund with an external method.'
            : !(target > 0)
              ? 'Nothing is left to refund.'
              : null

  const ceilingPaid = await externalRefundCeiling(paymentOrderId)
  const ceiling = ceilingPaid ?? Number(o.total_amount)
  const suggested = o.status === 'returned' || o.status === 'cancelled' ? refundable : Number(o.total_amount)
  const razorpayPaid = !!o.original_order_id || payments.length > 0
  const methods = (Object.keys(EXTERNAL_REFUND_METHODS) as ExternalRefundMethod[]).filter(
    m => !RAZORPAY_ONLY_METHODS.includes(m) || (razorpayPaid && ceilingPaid !== null)
  )

  const changeRefunds = await queryMany<{ id: string; amount: string; legacy: boolean }>(
    `SELECT id::text, abs(net_diff)::text AS amount, false AS legacy FROM order_adjustments WHERE order_id = $1::uuid AND refund_status = 'pending'
     UNION ALL
     SELECT id::text, abs(price_diff)::text AS amount, true AS legacy FROM variant_change_requests
      WHERE order_id = $1::uuid AND settlement_type = 'refund' AND status = 'applied' AND refund_id IS NULL`,
    [o.id]
  ).catch(() => [])

  return {
    refundable,
    razorpayCapacity,
    razorpay: { available: !razorpayReason, amount: razorpayReason ? 0 : Math.round(target * 100) / 100, reason: razorpayReason, payments },
    external: {
      available: MONEY_IN.includes(o.payment_status),
      ceiling,
      defaultAmount: Math.round(Math.min(ceiling, suggested) * 100) / 100,
      methods,
      reason: MONEY_IN.includes(o.payment_status) ? null : `Payment is '${o.payment_status}' — only a paid order can be marked refunded.`,
    },
    changeRefunds: changeRefunds.map(r => ({ adjustmentId: r.id, amount: Number(r.amount), legacy: !!r.legacy })),
  }
}

const get_order_refund_options: ToolDef = {
  name: 'get_order_refund_options',
  description:
    'Before proposing a refund: what can be refunded on an order, how, and whether this user may do it. Returns the refundable amount (after any return charge), captured Razorpay payments and what each can still refund, the external methods allowed (bank transfer, UPI, cash, dispute…), pending refunds owed for approved order changes, and the ceilings the refund endpoint enforces.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order UUID.' },
      orderNumber: { type: 'string', description: 'Alternative to orderId.' },
    },
  },
  mutating: false,
  handler: async (input, actor) => {
    const o = await findOrder(input)
    if (!o) return err('Order not found.')
    const opts = await refundOptions(o)
    const canRefund = !!actor && hasScope(actor.role, actor.scopes || [], 'orders:write')
    return {
      order: {
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        payment_status: o.payment_status,
        total: Number(o.total_amount),
        source: o.source,
      },
      refundable_amount: opts.refundable,
      razorpay: {
        available: opts.razorpay.available,
        amount: opts.razorpay.amount,
        note: opts.razorpay.reason ?? 'Refunds the full refundable amount to the original payment(s); partial Razorpay refunds are not supported here.',
        captured_payments: opts.razorpay.payments,
      },
      external: {
        available: opts.external.available,
        default_amount: opts.external.defaultAmount,
        max_amount: opts.external.ceiling,
        methods: opts.external.methods.map(m => ({ method: m, label: externalRefundLabel(m) })),
        note:
          opts.external.reason ??
          'Records a refund made outside the app (moves no money). Marks the order payment refunded even for a partial amount.',
      },
      pending_change_refunds: opts.changeRefunds,
      this_user: {
        role: actor?.role ?? null,
        can_refund: canRefund,
        note: canRefund ? 'May propose a refund (needs their approval).' : 'Their role lacks Orders write — they cannot refund.',
      },
    }
  },
}

const propose_refund_order: ToolDef = {
  name: 'propose_refund_order',
  description:
    "Propose a refund through the order page's refund flow (validations, Razorpay Route clawback, customer email, audit). method 'razorpay' refunds the full refundable amount of a cancelled/returned order to its captured Razorpay payment(s). Any other method records a refund already made outside the app: razorpay_dispute, razorpay_dashboard, bank_transfer, upi, cash, cheque, other. Pass adjustmentId to settle a pending refund owed for approved order changes. Call get_order_refund_options first.",
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order UUID.' },
      orderNumber: { type: 'string', description: 'Alternative to orderId.' },
      method: { type: 'string', description: `razorpay | ${Object.keys(EXTERNAL_REFUND_METHODS).join(' | ')}` },
      amount: { type: 'number', description: 'Optional. Defaults to the full refundable amount. Razorpay always refunds the full refundable amount.' },
      reason: { type: 'string', description: 'Required: why the refund is made (audit log; also the note on external refunds).' },
      notes: { type: 'string', description: 'Optional extra detail.' },
      reference: { type: 'string', description: 'External methods: UTR, UPI transaction id, cheque number, refund/dispute id.' },
      notifyCustomer: { type: 'boolean', description: 'Email the customer about the refund (default true; order refunds only).' },
      adjustmentId: { type: 'string', description: 'A pending change refund from get_order_refund_options.' },
    },
    required: ['method', 'reason'],
  },
  mutating: true,
  handler: async (input, actor) => {
    if (actor && !hasScope(actor.role, actor.scopes || [], 'orders:write')) {
      return err(`This user's role (${roleName(actor)}) can't refund orders — it needs Orders write.`)
    }
    const method = str(input.method).toLowerCase()
    const isRazorpay = method === 'razorpay'
    if (!isRazorpay && !(method in EXTERNAL_REFUND_METHODS)) {
      return err(`method must be razorpay or one of: ${Object.keys(EXTERNAL_REFUND_METHODS).join(', ')}`)
    }
    const reason = str(input.reason).slice(0, 500)
    if (reason.length < 3) return err('Give a reason for the refund.')
    const notes = str(input.notes).slice(0, 500)
    const reference = str(input.reference).slice(0, 120) || null
    const notify = input.notifyCustomer === undefined ? true : flag(input.notifyCustomer)
    const asked = input.amount === undefined || input.amount === null || input.amount === '' ? null : Number(input.amount)
    if (asked !== null && !(asked > 0)) return err('amount must be a positive number.')

    const o = await findOrder(input)
    if (!o) return err('Order not found.')
    const opts = await refundOptions(o)
    const note = [reason, notes].filter(Boolean).join(' — ').slice(0, 500)
    const external = isRazorpay ? null : parseExternalRefund({ method, reference, note })
    if (typeof external === 'string') return err(external)
    if (external && !opts.external.methods.includes(external.method)) {
      return err(`${externalRefundLabel(method)} only applies to money collected through Razorpay; this order has no Razorpay payment.`)
    }
    const how = isRazorpay ? 'Razorpay' : `${externalRefundLabel(method)}${reference ? ` (${reference})` : ''}`

    // A refund owed for approved order changes: the adjustment refund route, fixed amount.
    const adjustmentId = str(input.adjustmentId)
    if (adjustmentId) {
      const due = opts.changeRefunds.find(r => r.adjustmentId === adjustmentId)
      if (!due) return err('That change refund is not pending on this order. Check get_order_refund_options.')
      if (asked !== null && Math.abs(asked - due.amount) > 0.01) return err(`This change refund is fixed at ${money(due.amount)}.`)
      if (isRazorpay && opts.razorpayCapacity + 0.01 < due.amount) {
        return err(`The captured Razorpay payments can only refund ${money(opts.razorpayCapacity)}. Record it with an external method instead.`)
      }
      if (external && opts.external.ceiling + 0.01 < due.amount) {
        return err(`Only ${money(opts.external.ceiling)} is left to refund on this order's payments.`)
      }
      return proposal(
        'refund_order',
        { orderId: o.id, orderNumber: o.order_number, method, amount: due.amount, reason, notes: notes || null, reference, notify: false, adjustmentId, legacy: due.legacy },
        `Refund ${money(due.amount)} for the approved changes on order ${o.order_number} via ${how}?`,
        changeSummary(
          'Refund for order changes',
          o,
          [{ field: 'Change refund', from: 'pending', to: `${money(due.amount)} via ${how}`, tone: 'warn' }],
          [isRazorpay ? `Refunds ${money(due.amount)} to the customer's Razorpay payment(s)` : `Records ${money(due.amount)} refunded by ${how} — moves no money`],
          []
        )
      )
    }

    if (isRazorpay) {
      if (!opts.razorpay.available) return err(`Razorpay refund not possible: ${opts.razorpay.reason}`)
      if (asked !== null && Math.abs(asked - opts.razorpay.amount) > 0.01) {
        return err(
          `The order refund through Razorpay is always the full refundable ${money(opts.razorpay.amount)}. For a different amount, refund it from the Razorpay dashboard and record it with method razorpay_dashboard.`
        )
      }
    } else if (!opts.external.available) {
      return err(opts.external.reason!)
    }
    const amount = isRazorpay ? opts.razorpay.amount : asked ?? opts.external.defaultAmount
    if (!(amount > 0)) return err('Nothing to refund on this order.')
    if (!isRazorpay && amount > opts.external.ceiling + 0.01) return err(`At most ${money(opts.external.ceiling)} was paid on this order.`)

    const total = Number(o.total_amount)
    const effects = [
      isRazorpay
        ? `Refunds ${money(amount)} to the customer's original payment via Razorpay${opts.razorpay.payments.length > 1 ? ` (${opts.razorpay.payments.length} payments)` : ''}`
        : `Records ${money(amount)} refunded by ${how} — the app moves no money`,
      ...(isRazorpay || RAZORPAY_ONLY_METHODS.includes(method as ExternalRefundMethod) ? ['Reverses the Razorpay Route transfer for the refunded share, where one was made'] : []),
      ...(o.status === 'cancelled' || (!isRazorpay && o.status !== 'returned' && amount >= total - 0.01) ? ['Revokes access to any digital items'] : []),
      ...(notify && o.customer_email ? [`Emails ${o.customer_email} that the refund was made`] : []),
      'Logs the refund and your reason in the audit log',
    ]
    const warnings = [
      ...(o.status === 'returned' && opts.refundable < total - 0.01 ? [`Return charge deducted: refundable is ${money(opts.refundable)} of ${money(total)}.`] : []),
      ...(!isRazorpay && amount < opts.external.ceiling - 0.01
        ? [`Partial: ${money(amount)} of ${money(opts.external.ceiling)} paid. The order is still marked refunded, so the remaining ${money(opts.external.ceiling - amount)} can't be refunded through the app later.`]
        : []),
    ]
    return proposal(
      'refund_order',
      { orderId: o.id, orderNumber: o.order_number, method, amount, reason, notes: notes || null, reference, notify, adjustmentId: null, legacy: false },
      `Refund ${money(amount)} on order ${o.order_number} via ${how}?`,
      changeSummary(
        'Refund order',
        o,
        [
          { field: 'Payment status', from: label(o.payment_status), to: 'refunded', tone: 'danger' },
          { field: 'Refund', to: `${money(amount)} via ${how}`, tone: 'warn' },
        ],
        effects,
        warnings
      )
    )
  },
}

export const ORDER_TOOLS: ToolDef[] = [
  get_order_refund_options,
  propose_update_order_status,
  mark_order_shipped,
  propose_set_payment_status,
  propose_mark_invoice_paid,
  propose_cancel_order,
  propose_refund_order,
]
