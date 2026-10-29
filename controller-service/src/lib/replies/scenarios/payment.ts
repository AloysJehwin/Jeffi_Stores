import 'server-only'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import { createOrderPaymentLink } from '@/lib/payments/payment-link'
import type { IntentDef, Scenario } from '../types'
import { cancelForCustomer } from './cancel'

// An unpaid invoice, or a payment that failed: the customer asks to pay (gets a payment link),
// says they already paid (an admin checks, with their screenshot), disputes it, or cancels.

interface Snap {
  orderId: string
  number: string
  invoiceNumber: string | null
  total: number
  paymentStatus: string
  status: string
  userId: string | null
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const UNPAID = ['unpaid', 'failed']

async function load(orderId: string, invoiced: boolean): Promise<Snap | null> {
  // An invoice can be queried or disputed after it is paid; a failed payment only while it is unpaid.
  const o = await queryOne<any>(
    `SELECT id, order_number, invoice_number, total_amount, payment_status, status, user_id FROM orders
      WHERE id = $1 AND status NOT IN ('cancelled', 'cancel_requested')
        AND ${invoiced ? 'invoice_number IS NOT NULL' : 'payment_status = ANY($2::text[])'}`,
    invoiced ? [orderId] : [orderId, UNPAID]
  )
  if (!o) return null
  return { orderId: o.id, number: o.order_number, invoiceNumber: o.invoice_number, total: Number(o.total_amount), paymentStatus: o.payment_status, status: o.status, userId: o.user_id }
}

const isPaid = (s: Snap) => ['paid', 'cod_collected'].includes(s.paymentStatus)
const label = (s: Snap) => (s.invoiceNumber ? `invoice ${s.invoiceNumber}` : `order ${s.number}`)

const payLink: IntentDef = {
  describe: 'They want to pay now: ask for a payment link, how to pay, or to try again.',
  tier: 'auto',
  title: s => `Send a payment link for ${label(s)} (${rupees(s.total)})`,
}
const alreadyPaid: IntentDef = {
  describe: 'They say they have already paid (often with a screenshot, UTR or transaction reference).',
  tier: s => (isPaid(s) ? 'auto' : 'admin'),
  manual: true,
  args: z.object({ reference: z.string().max(200).optional() }),
  title: (s, a) => `Customer says ${label(s)} is paid${a?.reference ? ` (ref ${a.reference})` : ''}: check the payment`,
}

async function sendLink(s: Snap) {
  if (isPaid(s)) return { ok: true, text: `${label(s)[0].toUpperCase()}${label(s).slice(1)} is already paid. Thank you!` }
  if (s.paymentStatus === 'cod_pending') return { ok: true, text: `Order ${s.number} is cash on delivery: you can pay when it arrives.` }
  try {
    const l = await createOrderPaymentLink(s.orderId, 48, false)
    return { ok: true, close: false, text: `Here's your secure payment link for ${rupees(s.total)}: ${l.paymentLinkUrl}` }
  } catch (err) {
    console.error('[replies] payment link failed', err instanceof Error ? err.message : err)
    return { ok: false, text: `We couldn't create a payment link just now; our team will send you one shortly.` }
  }
}

export const invoicePayment: Scenario<Snap> = {
  key: 'invoice_payment',
  label: 'Invoice payment',
  scope: 'invoices:write',
  href: ctx => `/admin/invoices/${ctx.entity_id}/view`,
  snapshot: ctx => load(ctx.entity_id, true),
  describe: s => `We sent the customer invoice ${s.invoiceNumber} for order ${s.number}, ${rupees(s.total)}: ${isPaid(s) ? 'already paid' : s.paymentStatus === 'cod_pending' ? 'cash on delivery' : 'not paid yet'}.`,
  intents: {
    pay_link: payLink,
    already_paid: alreadyPaid,
    dispute: {
      describe: 'Something on the invoice is wrong: amount, items, quantities, GST number, name or address.',
      tier: 'admin',
      manual: true,
      args: z.object({ issue: z.string().max(500) }),
      title: (s, a) => `Customer disputes invoice ${s.invoiceNumber}: ${a?.issue ?? ''}`,
    },
  },
  async execute(intent, _args, s) {
    if (intent === 'pay_link') return sendLink(s)
    if (intent === 'already_paid')
      return { ok: true, text: isPaid(s) ? `Yes, invoice ${s.invoiceNumber} is marked paid. Thank you!` : `Thanks! We'll check the payment for invoice ${s.invoiceNumber} and confirm shortly.` }
    if (intent === 'dispute') return { ok: true, text: `Thanks for pointing that out. Our team will check invoice ${s.invoiceNumber} and send a corrected one if needed.` }
    return { ok: false, text: 'Unknown request' }
  },
}

export const paymentFailed: Scenario<Snap> = {
  key: 'payment_failed',
  label: 'Failed payment',
  scope: 'orders:write',
  href: ctx => `/admin/orders/${ctx.entity_id}/view`,
  snapshot: ctx => load(ctx.entity_id, false),
  describe: s => `We told the customer the payment for order ${s.number} (${rupees(s.total)}) did not go through.`,
  intents: {
    pay_link: payLink,
    already_paid: alreadyPaid,
    cancel: {
      describe: 'They no longer want the order.',
      tier: 'confirm',
      title: s => `Cancel order ${s.number}`,
    },
  },
  async execute(intent, _args, s, ctx) {
    if (intent === 'pay_link') return sendLink(s)
    if (intent === 'already_paid') return { ok: true, text: `Thanks! We'll check the payment for order ${s.number} and confirm shortly.` }
    if (intent === 'cancel') return cancelForCustomer(s.orderId, s.number, ctx.userId)
    return { ok: false, text: 'Unknown request' }
  },
}
