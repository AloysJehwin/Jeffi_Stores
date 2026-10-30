import 'server-only'
import { queryMany, queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { controlPlanePool } from '@/lib/tenant-registry'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { applyRefundEvent } from './refund-records'
import { razorpayAccountFor, type RazorpayAccount } from './rzp-account'
import { onPaymentCaptured } from './razorpay-events/payments'
import type { EventContext } from './razorpay-events/context'

/**
 * Catches what a lost webhook and a closed tab would miss: captured payments with no order here are
 * applied the way payment.captured would, and refunds still pending after two hours are re-read.
 * Route stores have no account of their own; the flagship's sweep covers their payments.
 */

const WINDOW_SEC = 3 * 3600
// Younger payments are still being verified by checkout or the webhook.
const SETTLE_SEC = 5 * 60
const RECOVERED = new Set(['paid', 'committed', 'adjustment', 'variant_change'])

export async function sweepRazorpay(): Promise<RunResult> {
  const account = await razorpayAccountFor()
  const { instance } = await getRazorpayInstanceFor(account.tenantId ?? undefined)
  return withChannelLock('razorpay', 'razorpay_sweep', 'sweep', async ctx => {
    if (account.kind !== 'route') await ctx.step('recovered', () => sweepPayments(instance, account))
    await ctx.step('refunds', () => pollPendingRefunds(instance, account))
  })
}

async function eventContext(account: RazorpayAccount): Promise<EventContext> {
  if (account.kind !== 'own') return { source: 'platform', store: null, eventId: null, accountId: null }
  const t = await resolveRequestTenant()
  return { source: 'own', store: t ? { tenantId: t.tenantId, slug: t.slug, ctx: t } : null, eventId: null, accountId: null }
}

async function sweepPayments(instance: any, account: RazorpayAccount): Promise<number> {
  const ctx = await eventContext(account)
  const now = Math.floor(Date.now() / 1000)
  let recovered = 0
  for (let skip = 0; skip < 2000; skip += 100) {
    const page = await instance.payments.all({ from: now - WINDOW_SEC, to: now - SETTLE_SEC, count: 100, skip })
    const items: any[] = Array.isArray(page?.items) ? page.items : []
    const elsewhere = account.kind === 'platform' ? await recordedForStores(items.map(p => p.id)) : new Set<string>()
    for (const p of items) {
      if (p.status === 'authorized') {
        notifyUncaptured(p)
        continue
      }
      // Subscription invoices are charged and recorded by the subscription events.
      if (p.status !== 'captured' || p.invoice_id || elsewhere.has(p.id)) continue
      if (await queryOne(`SELECT 1 FROM payments WHERE transaction_id = $1 AND status = 'completed'`, [p.id])) continue
      const out = await onPaymentCaptured(p, ctx).catch(e => {
        console.warn('[razorpay-sweep] apply failed', p.id, e?.message ?? e)
        return 'error'
      })
      if (RECOVERED.has(out)) recovered++
      else if (out === 'unmatched') notifyUnmatched(p)
    }
    if (items.length < 100) break
  }
  return recovered
}

/** Payments the control plane already booked for a store (the flagship's account collects for Route stores). */
async function recordedForStores(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const r = await controlPlanePool()
    .query<{ payment_id: string }>(`SELECT payment_id FROM tenant_transactions WHERE payment_id = ANY($1)`, [ids])
    .catch(() => null)
  return new Set((r?.rows ?? []).map(x => x.payment_id))
}

const rs = (paise: unknown) => (Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })

function notifyUnmatched(p: any) {
  createAdminNotification({
    type: 'razorpay_unmatched_payment',
    category: 'finance',
    title: `Rs. ${rs(p.amount)} captured with no order — ${p.id}`,
    message: 'Razorpay took this payment but no order or checkout here matches it. Create the order or refund the customer from the Razorpay dashboard.',
    link: `https://dashboard.razorpay.com/app/payments/${p.id}`,
    entityType: 'razorpay_payment',
    entityId: p.id,
    severity: 'critical',
    scope: 'financial:read',
  }).catch(() => {})
}

// Auto-capture is expected; an authorized payment left alone is refunded by Razorpay after a few days.
function notifyUncaptured(p: any) {
  if (Date.now() / 1000 - Number(p.created_at) < 30 * 60) return
  createAdminNotification({
    type: 'razorpay_uncaptured_payment',
    category: 'finance',
    title: `Rs. ${rs(p.amount)} authorized but not captured — ${p.id}`,
    message: 'Turn on automatic capture in the Razorpay dashboard (Account & Settings → Payment capture), or capture this payment there.',
    link: `https://dashboard.razorpay.com/app/payments/${p.id}`,
    entityType: 'razorpay_payment',
    entityId: p.id,
    severity: 'warning',
    scope: 'financial:read',
  }).catch(() => {})
}

/** Refunds Razorpay hasn't reported back on: read their status and apply it like the webhook would. */
async function pollPendingRefunds(instance: any, account: RazorpayAccount): Promise<number> {
  const rows = await queryMany<{ razorpay_refund_id: string }>(
    `SELECT razorpay_refund_id FROM payment_refunds
      WHERE status = 'pending' AND created_at < NOW() - INTERVAL '2 hours' AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at LIMIT 50`
  )
  const store = account.tenantId ? { tenantId: account.tenantId, slug: account.slug } : null
  let n = 0
  for (const r of rows) {
    const refund: any = await instance.refunds.fetch(r.razorpay_refund_id).catch(() => null)
    if (refund?.status !== 'processed' && refund?.status !== 'failed') continue
    await applyRefundEvent(`refund.${refund.status}`, refund, store)
    n++
  }
  return n
}

/**
 * Before an unpaid order is cancelled: did Razorpay take its payment after all (a lost webhook)? A
 * captured payment is applied and the order kept. 'unknown' when Razorpay couldn't be asked.
 */
export async function razorpayPaidBeforeCancel(order: {
  rzp_order_id: string | null
  payment_link_id: string | null
  razorpay_qr_id: string | null
}): Promise<'paid' | 'unpaid' | 'unknown'> {
  if (!order.rzp_order_id && !order.payment_link_id && !order.razorpay_qr_id) return 'unpaid'
  const { applyCapturedPayment, applyLinkPayment, applyQrPayment } = await import('./capture')
  try {
    const t = await resolveRequestTenant()
    const store = t ? { tenantId: t.tenantId, slug: t.slug } : null
    const { instance } = await getRazorpayInstanceFor(t?.tenantId)
    const captured = (list: any) => (Array.isArray(list?.items) ? list.items : []).find((p: any) => p.status === 'captured')

    if (order.rzp_order_id) {
      const p = captured(await instance.orders.fetchPayments(order.rzp_order_id))
      if (p) return (await applyCapturedPayment(p, store)) === 'unmatched' ? 'unknown' : 'paid'
    }
    if (order.payment_link_id) {
      const link: any = await instance.paymentLink.fetch(order.payment_link_id)
      const paid = (link?.payments ?? []).find((x: any) => x.status === 'captured')
      if (link?.status === 'paid' && paid?.payment_id) {
        await applyLinkPayment(link, await instance.payments.fetch(paid.payment_id), store)
        return 'paid'
      }
    }
    if (order.razorpay_qr_id) {
      const p = captured(await instance.qrCode.fetchAllPayments(order.razorpay_qr_id))
      if (p) {
        await applyQrPayment(await instance.qrCode.fetch(order.razorpay_qr_id), p, store)
        return 'paid'
      }
    }
    return 'unpaid'
  } catch (e: any) {
    console.warn('[cancel-stale-orders] Razorpay check failed', e?.message ?? e)
    return 'unknown'
  }
}
