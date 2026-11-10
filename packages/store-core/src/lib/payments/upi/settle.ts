import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { commitDraftFromCapture, markOrderPaid, type CaptureGateway, type PaidOrderRecord, type Store } from '@/lib/payments/capture'
import { recordCapturedPayment } from '@/lib/payments/route-settlement'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { settleVariantChangePayment } from '@/lib/orders/variant-change'
import { completedPayment, orderStatus, refundStatus, type PhonePeClientCreds } from './phonepe'
import { platformPhonePeCreds, resolvePhonePeCreds } from './creds'
import {
  claimIntentStatus,
  expireStalePhonePeIntents,
  findUpiIntent,
  pendingPhonePeIntents,
  storeDb,
  updateUpiIntent,
  type UpiDb,
  type UpiIntent,
  type UpiIntentStatus,
  type UpiResult,
} from './intents'
import { advanceVpa, alertCandidates, awaitingIntentByUtr, claimObservation, expireStaleQueued, openVpas, releaseObservation, trustedObservationByUtr, unappliedUpgIntents, type UpiObservation } from './upg'
import { matchAlert } from './upg-logic'

/**
 * Settlement of UPI intents (docs/plans/UPI_UPG_V2.md §1–2). The order side runs in the store the
 * intent pays; the intent row itself is read and written through `db` (the flagship DB for payments
 * made to the platform). Callers wrap in runInTenant or already run in the request's tenant context.
 */

export interface UpiTxn {
  transactionId: string
  utr?: string | null
  vpa?: string | null
}

/** How the money was confirmed: PhonePe's status API, a bank alert (UPG), or staff approving a UTR. */
export type UpiVia = 'phonepe' | 'upg' | 'manual'

const WALLET_PURPOSES = new Set(['wallet_topup', 'ecom_wallet_topup'])
const storeOf = (intent: UpiIntent, store?: Store): Store => store ?? (intent.tenant_id ? { tenantId: intent.tenant_id } : null)
const viaOf = (intent: UpiIntent, via?: UpiVia): UpiVia => via ?? (intent.provider === 'phonepe' ? 'phonepe' : 'upg')
/** payments.payment_gateway */
const PAYMENT_GATEWAY: Record<UpiVia, string> = { phonepe: 'phonepe', upg: 'upi_upg', manual: 'upi_manual' }
/** tenant_transactions.gateway */
const LEDGER_GATEWAY: Record<UpiVia, string> = { phonepe: 'upi_phonepe', upg: 'upi_upg', manual: 'upi_manual' }

/** Records a store's UPI sale. The money went straight to the store, so there is no commission or transfer. */
export async function recordUpiCapturedPayment(opts: {
  store: Store
  intent: UpiIntent
  paymentId: string
  totalAmountInr: number
  orderId: string
  orderRef: string
  via?: UpiVia
}): Promise<void> {
  if (!opts.store || isFlagship(opts.store) || WALLET_PURPOSES.has(opts.intent.purpose)) return
  await recordCapturedPayment({
    tenantId: opts.store.tenantId,
    tenantSlug: opts.store.slug ?? '',
    orderRef: opts.orderRef,
    orderId: opts.orderId,
    paymentId: opts.paymentId,
    grossInr: opts.totalAmountInr,
    collectedOn: 'own',
    gateway: LEDGER_GATEWAY[viaOf(opts.intent, opts.via)],
  })
}

function gatewayFor(intent: UpiIntent, txn: UpiTxn, via: UpiVia, decidedBy?: string | null): CaptureGateway {
  const gatewayResponse: Record<string, unknown> = {
    merchant_order_id: intent.merchant_order_id,
    upi_intent_id: intent.id,
    purpose: intent.purpose,
    transaction_id: txn.transactionId,
    ...(intent.provider_order_id ? { phonepe_order_id: intent.provider_order_id } : {}),
    ...(txn.utr ? { utr: txn.utr } : {}),
    ...(txn.vpa ? { vpa: txn.vpa } : {}),
    ...(decidedBy ? { decided_by: decidedBy } : {}),
    ...(intent.observation_id ? { observation_id: intent.observation_id } : {}),
  }
  return {
    gateway: PAYMENT_GATEWAY[via],
    method: 'upi',
    vpa: txn.vpa ?? null,
    gatewayResponse,
    label: via === 'phonepe' ? 'PhonePe' : 'UPI transfer',
    book: p => recordUpiCapturedPayment({ store: p.store, intent, paymentId: p.paymentId, totalAmountInr: p.totalAmountInr, orderId: p.orderId, orderRef: p.orderRef, via }),
  }
}

const orderByPayment = (transactionId: string) =>
  queryOne<{ id: string; order_number: string }>(
    `SELECT o.id, o.order_number FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.transaction_id = $1 LIMIT 1`,
    [transactionId]
  )

/** Applies a paid intent to what it was for. Idempotent per purpose; returns what to show the payer. */
export async function applyUpiPayment(intent: UpiIntent, txn: UpiTxn, opts: { store?: Store; decidedBy?: string | null; via?: UpiVia } = {}): Promise<UpiResult> {
  const store = storeOf(intent, opts.store)
  const via = viaOf(intent, opts.via)
  const gw = gatewayFor(intent, txn, via, opts.decidedBy)
  const refs = intent.refs
  const book = (p: { paymentId: string; grossInr: number; orderId: string; orderRef: string }) =>
    recordUpiCapturedPayment({ store, intent, paymentId: p.paymentId, totalAmountInr: p.grossInr, orderId: p.orderId, orderRef: p.orderRef, via })
  switch (intent.purpose) {
    case 'order_draft': {
      // A UTR awaiting approval committed its (unpaid) order at confirm time; approval pays that order.
      if (refs.orderId) return payOrder(refs.orderId, txn, store, gw)
      const r = await commitDraftFromCapture(intent.merchant_order_id, { id: txn.transactionId, amount: intent.amount_paise }, store, { via: 'UPI', gw })
      if (r.status === 'committed') return { orderId: r.order.id, orderNumber: r.order.order_number }
      if (r.status === 'needs_action') return { needsAction: r.reason }
      const existing = await orderByPayment(txn.transactionId)
      return existing ? { orderId: existing.id, orderNumber: existing.order_number } : {}
    }
    case 'order':
      if (!refs.orderId) return {}
      return payOrder(refs.orderId, txn, store, gw)
    case 'order_adjustment': {
      const { settleAdjustmentPayment } = await import('@/lib/orders/adjustments')
      const tenant = store && !isFlagship(store) ? { tenantId: store.tenantId, slug: store.slug } : null
      const r = await settleAdjustmentPayment({
        razorpayOrderId: intent.merchant_order_id,
        razorpayPaymentId: txn.transactionId,
        amountPaise: intent.amount_paise,
        tenant,
        gw: { gateway: gw.gateway!, method: 'upi', book },
      })
      return { orderId: refs.orderId, settlement: r.applied ? 'order_adjustment_applied' : r.reason }
    }
    case 'variant_change': {
      const r = await settleVariantChangePayment({
        razorpayOrderId: intent.merchant_order_id,
        razorpayPaymentId: txn.transactionId,
        amountPaise: intent.amount_paise,
        gw: { gateway: gw.gateway!, method: 'upi', book },
      })
      return { orderId: refs.orderId, settlement: r.applied ? 'variant_change_applied' : r.reason }
    }
    case 'wallet_topup':
    case 'ecom_wallet_topup': {
      if (!intent.tenant_id) return {}
      const { creditTopup } = await import('@/lib/billing/topup')
      const r = await creditTopup({ tenantId: intent.tenant_id, paymentId: txn.transactionId, paidPaise: intent.amount_paise, notes: refs.notes ?? null })
      if (!r.ok) throw new Error(r.error)
      return { balance: r.balance }
    }
  }
}

async function payOrder(orderId: string, txn: UpiTxn, store: Store, gw: CaptureGateway): Promise<UpiResult> {
  const record = await queryOne<PaidOrderRecord & { payment_status: string }>(
    `SELECT id AS order_id, id, payment_status, order_number, total_amount, shipping_amount, customer_email, customer_name, user_id, gclid, gbraid, wbraid
       FROM orders WHERE id = $1`,
    [orderId]
  )
  if (!record) return {}
  if (record.payment_status !== 'paid') {
    await markOrderPaid({ record, paymentId: txn.transactionId, gatewayResponse: gw.gatewayResponse!, store, gw, insertIfMissing: true })
  }
  return { orderId: record.order_id, orderNumber: record.order_number }
}

/** The PhonePe account that took the intent: the platform's for payments made to it, else the store's. */
async function credsForIntent(intent: UpiIntent): Promise<PhonePeClientCreds> {
  if (WALLET_PURPOSES.has(intent.purpose) || !intent.tenant_id) {
    const p = await platformPhonePeCreds()
    if (p) return p
  }
  return resolvePhonePeCreds(WALLET_PURPOSES.has(intent.purpose) ? null : intent.tenant_id)
}

/** PhonePe credentials for a payment's merchant order id (refunds go out on the account that collected). */
export async function credsForMerchantOrder(merchantOrderId: string): Promise<PhonePeClientCreds> {
  const intent = await findUpiIntent(merchantOrderId)
  if (intent) return credsForIntent(intent)
  return resolvePhonePeCreds()
}

const isExpired = (intent: UpiIntent) => !!intent.expires_at && new Date(intent.expires_at).getTime() < Date.now()

/**
 * Pending PhonePe intent → status API → completed / failed / expired, applying a completed payment once.
 * Returns the intent as it now stands (unchanged when nothing new happened).
 */
export async function settleUpiIntent(idOrMerchantOrderId: string, opts: { store?: Store; db?: UpiDb } = {}): Promise<UpiIntent | null> {
  const db = opts.db ?? storeDb
  const intent = await findUpiIntent(idOrMerchantOrderId, db)
  if (!intent) return null
  if (intent.status !== 'pending' || intent.provider !== 'phonepe') return intent

  const creds = await credsForIntent(intent)
  const status = await orderStatus(creds, intent.merchant_order_id)

  if (status.state === 'COMPLETED') {
    const paid = completedPayment(status)
    const txn: UpiTxn = {
      transactionId: paid?.transactionId || status.orderId || intent.merchant_order_id,
      utr: paid?.rail?.utr ?? paid?.rail?.upiTransactionId ?? null,
      vpa: paid?.rail?.vpa ?? null,
    }
    if (status.amount > 0 && Math.abs(status.amount - intent.amount_paise) > 1) {
      // PhonePe says a different amount was paid: never apply it blindly.
      return (await claimIntentStatus(intent.id, ['pending'], 'failed', { error_code: `amount_mismatch:${status.amount}`, provider_txn_id: txn.transactionId }, db)) ?? intent
    }
    const claimed = await claimIntentStatus(intent.id, ['pending'], 'completed', {
      provider_txn_id: txn.transactionId,
      utr: txn.utr ?? null,
      payer_vpa: txn.vpa ?? null,
      provider_order_id: status.orderId || intent.provider_order_id,
      error_code: null,
    }, db)
    if (!claimed) return (await findUpiIntent(intent.id, db)) ?? intent // another settle won
    try {
      const result = await applyUpiPayment(claimed, txn, { store: opts.store })
      return (await updateUpiIntent(claimed.id, { result }, db)) ?? claimed
    } catch (e: any) {
      // Hand it back to the sweep: the money is with PhonePe, the application failed here.
      console.error('[upi] apply after capture failed', { intentId: intent.id, purpose: intent.purpose, err: e?.message ?? e })
      await db.query(`UPDATE upi_payment_intents SET status = 'pending', error_code = $2, updated_at = NOW() WHERE id = $1 AND status = 'completed'`, [
        intent.id,
        String(e?.message ?? 'apply_failed').slice(0, 120),
      ]).catch(() => {})
      throw e
    }
  }
  if (status.state === 'FAILED') {
    const last = completedPayment(status)
    return (await claimIntentStatus(intent.id, ['pending'], 'failed', { error_code: status.errorCode ?? last?.errorCode ?? 'FAILED', provider_txn_id: last?.transactionId ?? null }, db)) ?? intent
  }
  if (isExpired(intent)) return (await claimIntentStatus(intent.id, ['pending'], 'expired', {}, db)) ?? intent
  return intent
}

// ── UPG ────────────────────────────────────────────────────────────────────────────────────────────

/** The order's waiting payment row follows how the money is being confirmed (bank alert vs staff). */
const setPendingPaymentGateway = (intent: UpiIntent, via: 'upg' | 'manual') =>
  WALLET_PURPOSES.has(intent.purpose)
    ? Promise.resolve()
    : query(`UPDATE payments SET payment_gateway = $2, updated_at = NOW() WHERE transaction_id = $1 AND status = 'pending' AND payment_gateway IN ('upi_upg', 'upi_manual')`, [
        intent.merchant_order_id,
        PAYMENT_GATEWAY[via],
      ]).then(() => {}, () => {})

const COMPLETABLE: UpiIntentStatus[] = ['active', 'processing', 'failed', 'expired', 'awaiting_confirmation']

/**
 * A trusted bank credit pays a UPG intent: the observation is claimed for it, the intent completes
 * and settles as upi_upg, and the next payer in line gets the UPI ID. Null when either was already taken.
 */
export async function completeUpgIntent(intent: UpiIntent, obs: UpiObservation, opts: { store?: Store; db?: UpiDb } = {}): Promise<UpiIntent | null> {
  const db = opts.db ?? storeDb
  if (intent.provider !== 'upg' || !obs.trusted || obs.amount_paise !== intent.amount_paise) return null
  if (!(await claimObservation(obs.id, intent.id, db))) return null
  const txn: UpiTxn = { transactionId: obs.utr || `UPG${obs.id.replace(/-/g, '')}`, utr: obs.utr ?? intent.utr, vpa: obs.sender_vpa }
  const claimed = await claimIntentStatus(intent.id, COMPLETABLE, 'completed', {
    provider_txn_id: txn.transactionId,
    utr: txn.utr ?? null,
    payer_vpa: txn.vpa ?? null,
    observation_id: obs.id,
    confirmed_at: new Date(),
    error_code: null,
  }, db)
  if (!claimed) {
    await releaseObservation(obs.id, intent.id, db).catch(() => {})
    return null
  }
  if (intent.status === 'awaiting_confirmation') await setPendingPaymentGateway(intent, 'upg')
  const done = await applyCompletedUpg(claimed, txn, opts)
  await advanceVpa(claimed.receiving_vpa, db).catch(() => {})
  return done
}

/** The bank has the money; a failed apply is retried by the sweep rather than undoing the completion. */
async function applyCompletedUpg(claimed: UpiIntent, txn: UpiTxn, opts: { store?: Store; db?: UpiDb }): Promise<UpiIntent> {
  const db = opts.db ?? storeDb
  try {
    const result = await applyUpiPayment(claimed, txn, { store: opts.store, via: 'upg' })
    return (await updateUpiIntent(claimed.id, { result, error_code: null }, db)) ?? claimed
  } catch (e: any) {
    console.error('[upi] apply after bank alert failed', { intentId: claimed.id, purpose: claimed.purpose, err: e?.message ?? e })
    return (await updateUpiIntent(claimed.id, { error_code: `apply_failed:${String(e?.message ?? '').slice(0, 100)}` }, db).catch(() => null)) ?? claimed
  }
}

/**
 * Matches a trusted credit to an intent on its UPI ID (exact amount; active/processing, then the
 * late-alert rule, then a UTR a customer already entered) and completes it.
 */
export async function matchObservation(obs: UpiObservation, opts: { store?: Store; db?: UpiDb } = {}): Promise<UpiIntent | null> {
  const db = opts.db ?? storeDb
  if (!obs.trusted || obs.kind !== 'credit' || !obs.receiving_vpa || !obs.amount_paise || obs.matched_intent_id) return null
  await advanceVpa(obs.receiving_vpa, db).catch(() => {})
  const hit = matchAlert(
    { receiving_vpa: obs.receiving_vpa, amount_paise: obs.amount_paise, observed_at: new Date(obs.observed_at).getTime() },
    await alertCandidates(obs.receiving_vpa, db)
  )
  let intent = hit ? await findUpiIntent(hit.intentId, db) : null
  if (!intent && obs.utr) intent = await awaitingIntentByUtr(obs.receiving_vpa, obs.utr, obs.amount_paise, db)
  return intent ? completeUpgIntent(intent, obs, opts) : null
}

const UTR_RE = /^[A-Za-z0-9]{8,32}$/

export class UpiConfirmError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'UpiConfirmError'
  }
}

/**
 * A payer whose UPG payment was not seen (failed / expired) enters the UTR. A trusted bank credit with
 * that UTR completes it at once; otherwise it waits for staff, and a checkout's order is placed unpaid
 * (payment_mode 'upi_manual') so they can approve it against the bank statement.
 */
export async function confirmUpgUtr(intentId: string, utr: string, opts: { store?: Store; db?: UpiDb } = {}): Promise<UpiIntent> {
  const db = opts.db ?? storeDb
  const clean = utr.trim().replace(/\s+/g, '').toUpperCase()
  if (!UTR_RE.test(clean)) throw new UpiConfirmError('Enter the UTR / transaction reference from your UPI app (8–32 letters and digits).', 400)
  const intent = await findUpiIntent(intentId, db)
  if (!intent) throw new UpiConfirmError('Payment not found', 404)
  if (intent.provider !== 'upg') throw new UpiConfirmError('This payment does not take a UTR', 400)
  if (intent.status === 'awaiting_confirmation' || intent.status === 'completed') return intent
  if (intent.status !== 'failed' && intent.status !== 'expired') throw new UpiConfirmError(`This payment is ${intent.status}`, 409)
  const store = storeOf(intent, opts.store)

  const seen = intent.receiving_vpa ? await trustedObservationByUtr(intent.receiving_vpa, clean, db).catch(() => null) : null
  if (seen && seen.amount_paise === intent.amount_paise) {
    const done = await completeUpgIntent(intent, seen, { store, db })
    if (done) return done
  }

  const prior = intent.status
  const claimed = await claimIntentStatus(intent.id, ['failed', 'expired'], 'awaiting_confirmation', { utr: clean, confirmed_at: new Date() }, db)
  if (!claimed) return (await findUpiIntent(intent.id, db)) ?? intent
  if (WALLET_PURPOSES.has(intent.purpose)) return claimed

  const moid = intent.merchant_order_id
  if (intent.purpose === 'order_draft' && !intent.refs.orderId) {
    const r = await commitDraftFromCapture(moid, { id: moid, amount: intent.amount_paise }, store, { via: 'UPI (UTR)', paid: false })
    if (r.status === 'needs_action') {
      await claimIntentStatus(intent.id, ['awaiting_confirmation'], prior, { error_code: r.reason.slice(0, 120) }, db)
      throw new UpiConfirmError(`${r.reason}. Please review your cart and try again.`, 409)
    }
    if (r.status === 'not_claimed') {
      const existing = await orderByPayment(moid)
      if (!existing) throw new UpiConfirmError('This checkout was already placed. Check My Orders.', 409)
      return (await updateUpiIntent(intent.id, { refs: { ...intent.refs, orderId: existing.id }, result: { orderId: existing.id, orderNumber: existing.order_number } }, db)) ?? claimed
    }
    await query(
      `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'upi', 'upi_manual', $2, $3, 'pending', $4) ON CONFLICT (transaction_id) DO NOTHING`,
      [r.order.id, moid, (intent.amount_paise / 100).toFixed(2), JSON.stringify({ merchant_order_id: moid, upi_intent_id: intent.id, purpose: 'order_draft', utr: clean })]
    )
    await query(`UPDATE orders SET payment_mode = 'upi_manual', updated_at = NOW() WHERE id = $1`, [r.order.id])
    return (await updateUpiIntent(intent.id, { refs: { ...intent.refs, orderId: r.order.id }, result: { orderId: r.order.id, orderNumber: r.order.order_number } }, db)) ?? claimed
  }
  await setPendingPaymentGateway(intent, 'manual')
  if (intent.refs.orderId) {
    await query(
      `UPDATE payments SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
        WHERE order_id = $1 AND transaction_id = $3 AND payment_gateway = 'upi_manual'`,
      [intent.refs.orderId, JSON.stringify({ utr: clean, upi_intent_id: intent.id }), moid]
    )
    await query(`UPDATE orders SET payment_mode = 'upi_manual', updated_at = NOW() WHERE id = $1 AND payment_status <> 'paid'`, [intent.refs.orderId])
  }
  return claimed
}

/** Staff approve (pays it with transaction_id = UTR, as upi_manual) or reject (the order stays unpaid) a customer's UTR. */
export async function decideUpgUtr(intentId: string, action: 'approve' | 'reject', adminId: string | null, opts: { store?: Store; db?: UpiDb } = {}): Promise<UpiIntent> {
  const db = opts.db ?? storeDb
  const intent = await findUpiIntent(intentId, db)
  if (!intent) throw new UpiConfirmError('Payment not found', 404)
  if (intent.provider !== 'upg') throw new UpiConfirmError('Only payments to the UPI ID are approved here', 400)
  if (intent.status !== 'awaiting_confirmation') throw new UpiConfirmError(`This payment is ${intent.status}`, 409)
  const store = storeOf(intent, opts.store)
  const to: UpiIntentStatus = action === 'approve' ? 'completed' : 'rejected'
  const claimed = await claimIntentStatus(intent.id, ['awaiting_confirmation'], to, {
    decided_by: adminId,
    decided_at: new Date(),
    ...(action === 'approve' ? { provider_txn_id: intent.utr } : {}),
  }, db)
  if (!claimed) throw new UpiConfirmError('Already decided', 409)
  if (action === 'reject') {
    await query(`UPDATE payments SET status = 'failed', error_description = 'UTR rejected by staff', updated_at = NOW() WHERE transaction_id = $1 AND payment_gateway = 'upi_manual' AND status = 'pending'`, [
      intent.merchant_order_id,
    ]).catch(() => {})
    return claimed
  }
  const txn: UpiTxn = { transactionId: intent.utr || intent.merchant_order_id, utr: intent.utr }
  try {
    const result = await applyUpiPayment(claimed, txn, { store, decidedBy: adminId, via: 'manual' })
    return (await updateUpiIntent(claimed.id, { result }, db)) ?? claimed
  } catch (e: any) {
    await db.query(`UPDATE upi_payment_intents SET status = 'awaiting_confirmation', error_code = $2, updated_at = NOW() WHERE id = $1 AND status = 'completed'`, [
      intent.id,
      String(e?.message ?? 'apply_failed').slice(0, 120),
    ]).catch(() => {})
    throw e
  }
}

/** UPG housekeeping: timers and promotion for every UPI ID in use, abandoned queue entries, applies that threw. */
export async function sweepUpgSessions(opts: { store?: Store; db?: UpiDb } = {}): Promise<{ vpas: number; promoted: number; staleQueued: number; reapplied: number }> {
  const db = opts.db ?? storeDb
  const out = { vpas: 0, promoted: 0, staleQueued: 0, reapplied: 0 }
  out.staleQueued = await expireStaleQueued(2 * 3600, db).catch(() => 0)
  for (const vpa of await openVpas(db).catch(() => [] as string[])) {
    out.vpas++
    if (await advanceVpa(vpa, db).catch(() => null)) out.promoted++
  }
  for (const i of await unappliedUpgIntents(db).catch(() => [] as UpiIntent[])) {
    const txn: UpiTxn = { transactionId: i.provider_txn_id || i.utr || i.merchant_order_id, utr: i.utr, vpa: i.payer_vpa }
    const r = await applyCompletedUpg(i, txn, { store: opts.store, db })
    if (r.result) out.reapplied++
  }
  return out
}

/** PhonePe refunds not yet reported back: read their state and move the refund record on. */
async function pollPhonePeRefunds(limit = 50): Promise<number> {
  const rows = await query(
    `SELECT pr.razorpay_refund_id AS refund_id, pr.razorpay_payment_id AS payment_id, pr.amount, p.gateway_response->>'merchant_order_id' AS moid
       FROM payment_refunds pr LEFT JOIN payments p ON p.id = pr.payment_id
      WHERE pr.status = 'pending' AND pr.razorpay_refund_id LIKE 'RF%' AND pr.created_at < NOW() - INTERVAL '10 minutes' AND pr.created_at > NOW() - INTERVAL '30 days'
      ORDER BY pr.created_at LIMIT $1`,
    [limit]
  ).catch(() => ({ rows: [] as any[] }))
  let n = 0
  for (const r of rows.rows as any[]) {
    const intent = r.moid ? await findUpiIntent(String(r.moid)).catch(() => null) : null
    if (!intent) continue
    const creds = await credsForIntent(intent).catch(() => null)
    if (!creds) continue
    const s = await refundStatus(creds, r.refund_id).catch(() => null)
    if (!s || (s.state !== 'COMPLETED' && s.state !== 'FAILED')) continue
    await applyPhonePeRefundState(r.refund_id, s.state, { paymentId: r.payment_id, amountPaise: Math.round(Number(r.amount) * 100) }, storeOf(intent))
    n++
  }
  return n
}

/** Moves a PhonePe refund record to processed / failed (the Razorpay-shaped record keeps our ids). */
export async function applyPhonePeRefundState(
  merchantRefundId: string,
  state: string,
  p: { paymentId: string; amountPaise: number; utr?: string | null },
  store: Store
): Promise<void> {
  const s = state.toUpperCase()
  if (s !== 'COMPLETED' && s !== 'FAILED') return
  const { applyRefundEvent } = await import('@/lib/payments/refund-records')
  await applyRefundEvent(
    s === 'COMPLETED' ? 'refund.processed' : 'refund.failed',
    { id: merchantRefundId, payment_id: p.paymentId, amount: p.amountPaise, status: s === 'COMPLETED' ? 'processed' : 'failed', acquirer_data: p.utr ? { utr: p.utr } : undefined },
    store
  )
}

/** Settles pending PhonePe intents 2 min–24 h old (lost webhook / closed tab), polls open refunds, and keeps UPG queues moving. */
export async function sweepUpiIntents(opts: { store?: Store } = {}): Promise<{ scanned: number; completed: number; failed: number; expired: number; refunds: number; upg?: Awaited<ReturnType<typeof sweepUpgSessions>> }> {
  const out: { scanned: number; completed: number; failed: number; expired: number; refunds: number; upg?: Awaited<ReturnType<typeof sweepUpgSessions>> } = { scanned: 0, completed: 0, failed: 0, expired: 0, refunds: 0 }
  out.upg = await sweepUpgSessions({ store: opts.store }).catch(() => undefined)
  const intents = await pendingPhonePeIntents({ minAgeSec: 120, maxAgeSec: 24 * 3600 })
  for (const i of intents) {
    out.scanned++
    const r = await settleUpiIntent(i.id, { store: opts.store }).catch(e => {
      console.warn('[upi-sweep] settle failed', i.id, e?.message ?? e)
      return null
    })
    if (r?.status === 'completed') out.completed++
    else if (r?.status === 'failed') out.failed++
    else if (r?.status === 'expired') out.expired++
  }
  out.expired += await expireStalePhonePeIntents(24 * 3600).catch(() => 0)
  out.refunds = await pollPhonePeRefunds().catch(() => 0)
  return out
}
