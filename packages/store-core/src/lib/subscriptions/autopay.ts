import 'server-only'
import { randomBytes, randomUUID } from 'crypto'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import {
  autopayCreds,
  autopayOrderStatus,
  autopaySignupCreds,
  cancelMandate,
  completedAutopayPayment,
  executeRedemption,
  mandateStatus,
  notifyRedemption,
  setupMandate,
  type AutopayCreds,
  type AutopayOrderStatus,
  type MandateStatus,
} from '@/lib/payments/upi/autopay'
import { PhonePeError } from '@/lib/payments/upi/phonepe'
import { INTERVAL_SPEC } from './intervals'
import { deriveSubscriptionOffer, snapshotAddress, type OfferInput } from './offer'
import { applySubscriptionState, commitCycle, type TenantRef } from './cycle'
import {
  AUTOPAY_FREQUENCY,
  REDEMPTION_WINDOW_MS,
  SETUP_ABANDON_MS,
  asInterval,
  cyclePeriod,
  executeAfter,
  mandateExpiry,
  nextRenewalStep,
  redemptionExpiry,
  redemptionStep,
  statusForMandateState,
  NOTIFY_LEAD_MS,
} from './autopay-schedule'
import { SubscriptionError, type SubscriptionRow } from './types'

// Customer subscriptions billed through PhonePe Autopay (docs/plans/UPI_UPG_V2.md §6): sign-up, the
// renewal run and the state changes. Every caller is already inside the store's DB context.

const CONSENT_VERSION = 'v1'
const TERMINAL = new Set(['cancelled', 'completed', 'expired'])

export type Store = TenantRef | null

export const isAutopay = (sub: Pick<SubscriptionRow, 'billing_provider'>) => sub.billing_provider === 'phonepe'

/** True when this store's subscription checkout offers PhonePe Autopay. */
export async function autopayAvailable(tenantId: string | null | undefined): Promise<boolean> {
  return !!(await autopaySignupCreds(tenantId).catch(() => null))
}

async function credsFor(store: Store): Promise<AutopayCreds> {
  const creds = await autopayCreds(store?.tenantId ?? null)
  if (!creds) throw new SubscriptionError('UPI Autopay is not available for this store right now', 409)
  return creds
}

const loadRow = (id: string) => queryOne<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [id])
const cycleAmountPaise = (s: SubscriptionRow) =>
  Math.round(Number(s.unit_price_paise ?? 0) * Math.max(1, Math.round(Number(s.quantity ?? 1))) + (s.is_digital ? 0 : Number(s.shipping_paise ?? 0)))
const orderRef = (prefix: string, id: string, tail: string) => `${prefix}-${id.replace(/-/g, '').slice(0, 16)}-${tail}`

function gatewayFor(sub: SubscriptionRow, merchantOrderId: string, txn: { transactionId: string; utr?: string; umn?: string }) {
  return {
    method: 'upi',
    name: 'phonepe',
    settlement: 'upi_phonepe',
    response: {
      merchant_order_id: merchantOrderId,
      transaction_id: txn.transactionId,
      phonepe_subscription_id: sub.phonepe_subscription_id,
      merchant_subscription_id: sub.phonepe_merchant_subscription_id,
      ...(txn.utr ? { utr: txn.utr } : {}),
      ...(txn.umn ? { umn: txn.umn } : {}),
    },
  }
}

export interface AutopayStartResult {
  localId: string
  mode: 'phonepe_autopay'
  amountPaise: number
  redirectUrl: string
}

/** Creates the local subscription and the PhonePe mandate setup; the customer finishes on PhonePe's page. */
export async function createAutopaySubscription(input: OfferInput & { addressId: string; returnUrl: (localId: string) => string }): Promise<AutopayStartResult> {
  const offer = await deriveSubscriptionOffer(input)
  if (!offer.address) throw new SubscriptionError('Address is required')
  const store: Store = offer.tenantId ? { tenantId: offer.tenantId, slug: '' } : null
  const creds = await autopaySignupCreds(offer.tenantId)
  if (!creds) throw new SubscriptionError('UPI Autopay is not available for this store right now', 409)

  const spec = INTERVAL_SPEC[offer.interval]
  const localId = randomUUID()
  const merchantSubscriptionId = `SUB-${localId.replace(/-/g, '')}`
  const setupOrderId = orderRef('SUBS', localId, randomBytes(4).toString('hex'))
  const expiresAt = mandateExpiry(new Date(), offer.interval, offer.totalCount)

  await query(
    `INSERT INTO subscriptions (
       id, user_id, product_id, status, interval_minutes, next_renewal_at, source, billing_provider,
       phonepe_merchant_subscription_id, phonepe_setup_order_id, phonepe_mandate_expires_at,
       variant_id, sub_variant_id, quantity, interval, interval_count, period, unit_price_paise,
       unit_price_ex_gst, shipping_paise, gst_rate, hsn_code, is_digital, address_id, address_snapshot,
       collecting_account, current_cycle, total_count, min_cycles, term_cycles, consent_version, consent_at, locked_price_at
     ) VALUES (
       $1, $2, $3, 'created', $4, NOW() + make_interval(mins => $4), 'phonepe', 'phonepe',
       $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb,
       $22, 0, $23, $24, $25, $26, NOW(), NOW()
     )`,
    [
      localId,
      input.userId,
      offer.product.id,
      spec.minutes,
      merchantSubscriptionId,
      setupOrderId,
      expiresAt,
      offer.variantId,
      offer.subVariantId,
      offer.quantity,
      offer.interval,
      spec.interval,
      spec.period,
      Math.round(offer.unitPrice * 100),
      offer.unitPriceExGst,
      Math.round(offer.shipping * 100),
      offer.gstRate,
      offer.product.hsn_code,
      offer.isDigital,
      offer.address.id,
      JSON.stringify(snapshotAddress(offer.address)),
      store ? 'own' : 'platform',
      offer.totalCount,
      offer.minCycles,
      offer.totalCycles,
      CONSENT_VERSION,
    ]
  )

  try {
    const setup = await setupMandate(creds, {
      merchantOrderId: setupOrderId,
      merchantSubscriptionId,
      amountPaise: offer.amountPaise,
      maxAmountPaise: offer.amountPaise,
      frequency: AUTOPAY_FREQUENCY[offer.interval],
      expireAt: expiresAt,
      redirectUrl: input.returnUrl(localId),
      metaInfo: { udf1: offer.tenantId ?? 'cp', udf2: localId, udf3: 'subscription_setup' },
    })
    return { localId, mode: 'phonepe_autopay', amountPaise: offer.amountPaise, redirectUrl: setup.redirectUrl }
  } catch (err) {
    await query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'created'`, [localId]).catch(() => {})
    if (err instanceof PhonePeError) {
      console.error('[autopay] mandate setup failed', { code: err.code, status: err.status, message: err.message })
      throw new SubscriptionError('Could not start UPI Autopay. Please try again or pick another payment method.', 502)
    }
    throw err
  }
}

export interface AutopaySetupView {
  localId: string
  status: string
  /** pending = still waiting for the customer / bank. */
  setup: 'pending' | 'active' | 'failed'
  orderId: string | null
  orderNumber: string | null
}

async function firstOrder(subId: string) {
  return queryOne<{ id: string; order_number: string }>(`SELECT id, order_number FROM orders WHERE subscription_id = $1 ORDER BY subscription_cycle ASC NULLS LAST LIMIT 1`, [subId])
}

async function viewOf(sub: SubscriptionRow): Promise<AutopaySetupView> {
  const o = sub.status === 'created' ? null : await firstOrder(sub.id)
  return {
    localId: sub.id,
    status: sub.status,
    setup: sub.status === 'created' ? 'pending' : TERMINAL.has(sub.status) && !o ? 'failed' : 'active',
    orderId: o?.id ?? null,
    orderNumber: o?.order_number ?? null,
  }
}

async function saveMandate(subId: string, m: MandateStatus | null, subscriptionId?: string) {
  await query(
    `UPDATE subscriptions SET phonepe_subscription_id = COALESCE($2, phonepe_subscription_id), phonepe_mandate_state = COALESCE($3, phonepe_mandate_state),
            phonepe_mandate_expires_at = COALESCE($4, phonepe_mandate_expires_at), updated_at = NOW() WHERE id = $1`,
    [subId, m?.subscriptionId || subscriptionId || null, m?.state || null, m?.expireAt ?? null]
  )
}

/**
 * Reads the setup order from PhonePe and, once it is paid, commits the first cycle and activates the
 * subscription. Safe to call from the return page, the webhook and the cron at once.
 */
export async function syncAutopaySetup(localId: string, opts: { userId?: string; store: Store }): Promise<AutopaySetupView> {
  const sub = await loadRow(localId)
  if (!sub || !isAutopay(sub) || (opts.userId && sub.user_id !== opts.userId)) throw new SubscriptionError('Subscription not found', 404)
  if (sub.status !== 'created' || !sub.phonepe_setup_order_id) return viewOf(sub)

  const creds = await credsFor(opts.store)
  const order = await autopayOrderStatus(creds, sub.phonepe_setup_order_id)
  if (order.state === 'FAILED') {
    await query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'created'`, [sub.id])
    return viewOf((await loadRow(sub.id))!)
  }
  if (order.state !== 'COMPLETED') return viewOf(sub)

  const pay = completedAutopayPayment(order)
  const mandate = await mandateStatus(creds, sub.phonepe_merchant_subscription_id!).catch(() => null)
  await saveMandate(sub.id, mandate, order.subscriptionId)
  const fresh = (await loadRow(sub.id))!
  const paymentId = pay?.transactionId || order.orderId || sub.phonepe_setup_order_id
  const period = cyclePeriod(asInterval(sub.interval), null, pay?.at ?? new Date())
  await commitCycle({
    subscriptionId: sub.id,
    paymentId,
    gatewayOrderId: order.orderId || null,
    amountPaise: pay?.amountPaise || order.amountPaise || cycleAmountPaise(sub),
    paidCount: 1,
    currentStart: period.start,
    currentEnd: period.end,
    tenant: opts.store,
    gateway: gatewayFor(fresh, sub.phonepe_setup_order_id, { transactionId: paymentId, utr: pay?.utr, umn: pay?.umn }),
  })
  const { row } = await applySubscriptionState(sub.id, 'active', null)
  return viewOf(row)
}

interface RedemptionRow {
  id: string
  subscription_id: string
  cycle_number: number
  merchant_order_id: string
  amount_paise: string | number
  due_at: string | Date
  status: 'notifying' | 'notified' | 'executing' | 'completed' | 'failed' | 'cancelled'
  notified_at: string | Date | null
  execute_after: string | Date | null
}

const openRedemption = (subId: string) =>
  queryOne<RedemptionRow>(`SELECT * FROM subscription_redemptions WHERE subscription_id = $1 AND status IN ('notifying','notified','executing')`, [subId])

async function closeOpenRedemptions(subId: string, reason: string) {
  await query(
    `UPDATE subscription_redemptions SET status = 'cancelled', error_code = $2, updated_at = NOW()
      WHERE subscription_id = $1 AND status IN ('notifying','notified','executing')`,
    [subId, reason]
  )
}

/** Applies what PhonePe says about the mandate (cancelled / revoked / paused in the UPI app, expired). */
export async function applyMandateState(sub: SubscriptionRow, mandate: MandateStatus): Promise<SubscriptionRow> {
  const before = String(sub.phonepe_mandate_state ?? '').toUpperCase()
  await saveMandate(sub.id, mandate)
  const target = statusForMandateState(mandate.state)
  if (!target || TERMINAL.has(sub.status) || sub.status === 'created') return (await loadRow(sub.id))!
  if (target === 'cancelled' || target === 'expired') {
    await closeOpenRedemptions(sub.id, `mandate ${mandate.state.toLowerCase()}`)
    return (await applySubscriptionState(sub.id, target, null)).row
  }
  if (target === 'paused' && sub.status === 'active') {
    await closeOpenRedemptions(sub.id, 'mandate paused')
    return (await applySubscriptionState(sub.id, 'paused', null)).row
  }
  // Only a pause that came from the UPI app is lifted by it; a pause from our side stays.
  if (target === 'active' && sub.status === 'paused' && before === 'PAUSED') return (await applySubscriptionState(sub.id, 'active', null)).row
  return (await loadRow(sub.id))!
}

/** Re-reads the mandate from PhonePe and applies it. */
export async function syncAutopaySubscription(localId: string, store: Store): Promise<SubscriptionRow> {
  const sub = await loadRow(localId)
  if (!sub || !isAutopay(sub)) throw new SubscriptionError('Subscription not found', 404)
  if (sub.status === 'created') {
    await syncAutopaySetup(localId, { store })
    return (await loadRow(localId))!
  }
  const creds = await credsFor(store)
  return applyMandateState(sub, await mandateStatus(creds, sub.phonepe_merchant_subscription_id!))
}

async function failRedemption(r: RedemptionRow, code: string | undefined) {
  const done = await queryOne<{ id: string }>(
    `UPDATE subscription_redemptions SET status = 'failed', error_code = $2, completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('notifying','notified','executing') RETURNING id`,
    [r.id, (code ?? 'failed').slice(0, 120)]
  )
  // Same end state as a Razorpay subscription whose retries ran out: halted, payment-failed email.
  if (done) await applySubscriptionState(r.subscription_id, 'halted', null)
}

async function completeRedemption(r: RedemptionRow, sub: SubscriptionRow, order: AutopayOrderStatus, store: Store) {
  const pay = completedAutopayPayment(order)
  const paymentId = pay?.transactionId || order.orderId || r.merchant_order_id
  const period = cyclePeriod(asInterval(sub.interval), new Date(r.due_at), pay?.at ?? new Date())
  await commitCycle({
    subscriptionId: sub.id,
    paymentId,
    gatewayOrderId: order.orderId || null,
    amountPaise: pay?.amountPaise || order.amountPaise || Number(r.amount_paise),
    paidCount: r.cycle_number,
    currentStart: period.start,
    currentEnd: period.end,
    tenant: store,
    gateway: gatewayFor(sub, r.merchant_order_id, { transactionId: paymentId, utr: pay?.utr, umn: pay?.umn }),
  })
  await query(
    `UPDATE subscription_redemptions SET status = 'completed', provider_order_id = COALESCE($2, provider_order_id), provider_txn_id = $3, utr = $4,
            completed_at = NOW(), error_code = NULL, updated_at = NOW() WHERE id = $1`,
    [r.id, order.orderId || null, paymentId, pay?.utr ?? null]
  )
  if (sub.status === 'pending' || sub.status === 'halted') await applySubscriptionState(sub.id, 'active', null)
}

export type RedemptionOutcome = 'waiting' | 'notified' | 'executing' | 'completed' | 'failed' | 'cancelled'

/** Moves one open redemption as far as PhonePe allows right now. */
export async function advanceRedemption(redemptionId: string, store: Store, now = new Date()): Promise<RedemptionOutcome> {
  const r = await queryOne<RedemptionRow>(`SELECT * FROM subscription_redemptions WHERE id = $1`, [redemptionId])
  if (!r) return 'cancelled'
  if (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled') return r.status
  const sub = await loadRow(r.subscription_id)
  if (!sub || TERMINAL.has(sub.status)) {
    await closeOpenRedemptions(r.subscription_id, 'subscription ended')
    return 'cancelled'
  }
  const creds = await credsFor(store)
  const step = redemptionStep(r, now)
  if (step === 'wait' || step === 'done') return 'waiting'

  if (step === 'execute') {
    const mandate = await mandateStatus(creds, sub.phonepe_merchant_subscription_id!)
    if (mandate.state !== 'ACTIVE') {
      await applyMandateState(sub, mandate)
      return 'waiting'
    }
    try {
      const x = await executeRedemption(creds, r.merchant_order_id)
      await query(
        `UPDATE subscription_redemptions SET status = 'executing', executed_at = NOW(), provider_txn_id = COALESCE($2, provider_txn_id), error_code = NULL, updated_at = NOW()
          WHERE id = $1 AND status = 'notified'`,
        [r.id, x.transactionId || null]
      )
      if (x.state !== 'COMPLETED' && x.state !== 'FAILED') return 'executing'
    } catch (err) {
      if (!(err instanceof PhonePeError) || err.status >= 500) throw err
      const lapsed = now.getTime() > new Date(r.execute_after ?? r.due_at).getTime() + REDEMPTION_WINDOW_MS
      if (lapsed) {
        await failRedemption(r, err.code ?? 'execute_rejected')
        return 'failed'
      }
      await query(`UPDATE subscription_redemptions SET error_code = $2, updated_at = NOW() WHERE id = $1`, [r.id, (err.code ?? err.message).slice(0, 120)])
      return 'waiting'
    }
  }

  const order = await autopayOrderStatus(creds, r.merchant_order_id)
  if (order.state === 'COMPLETED') {
    await completeRedemption(r, sub, order, store)
    return 'completed'
  }
  if (order.state === 'FAILED') {
    await failRedemption(r, order.errorCode ?? completedAutopayPayment(order)?.errorCode)
    return 'failed'
  }
  if (r.status === 'notifying' && (order.state === 'NOTIFIED' || order.notifiedAt)) {
    const notifiedAt = order.notifiedAt ?? now
    await query(
      `UPDATE subscription_redemptions SET status = 'notified', notified_at = $2, execute_after = $3, provider_order_id = COALESCE($4, provider_order_id), updated_at = NOW()
        WHERE id = $1 AND status = 'notifying'`,
      [r.id, notifiedAt, executeAfter(new Date(r.due_at), notifiedAt, order.validAfter), order.orderId || null]
    )
    return 'notified'
  }
  return r.status === 'executing' ? 'executing' : 'waiting'
}

/** Sends the pre-debit notification for the next cycle. */
async function startRedemption(sub: SubscriptionRow, cycle: number, dueAt: Date, creds: AutopayCreds, now: Date): Promise<boolean> {
  const merchantOrderId = orderRef('SUBR', sub.id, `${cycle}-${randomBytes(3).toString('hex')}`)
  const amountPaise = cycleAmountPaise(sub)
  const row = await queryOne<{ id: string }>(
    `INSERT INTO subscription_redemptions (subscription_id, cycle_number, merchant_order_id, amount_paise, due_at, status)
     VALUES ($1, $2, $3, $4, $5, 'notifying')
     ON CONFLICT (subscription_id) WHERE (status IN ('notifying','notified','executing')) DO NOTHING
     RETURNING id`,
    [sub.id, cycle, merchantOrderId, amountPaise, dueAt]
  )
  if (!row) return false
  try {
    const n = await notifyRedemption(creds, {
      merchantOrderId,
      merchantSubscriptionId: sub.phonepe_merchant_subscription_id!,
      amountPaise,
      expireAt: redemptionExpiry(dueAt, now),
    })
    await query(`UPDATE subscription_redemptions SET provider_order_id = $2, updated_at = NOW() WHERE id = $1`, [row.id, n.orderId || null])
    return true
  } catch (err: any) {
    // Not sent: drop the row so the next run tries again with a new order id.
    await query(`UPDATE subscription_redemptions SET status = 'cancelled', error_code = $2, updated_at = NOW() WHERE id = $1`, [row.id, String(err?.code ?? err?.message ?? 'notify failed').slice(0, 120)])
    throw err
  }
}

export interface RenewalRunResult {
  setups: number
  abandoned: number
  notified: number
  executed: number
  completed: number
  failed: number
  ended: number
  errors: number
}

/** The renewal run: finish stale sign-ups, move open redemptions on, notify the cycles coming due, end finished terms. */
export async function runAutopayRenewals(opts: { store: Store; now?: Date }): Promise<RenewalRunResult> {
  const now = opts.now ?? new Date()
  const out: RenewalRunResult = { setups: 0, abandoned: 0, notified: 0, executed: 0, completed: 0, failed: 0, ended: 0, errors: 0 }
  const any = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM subscriptions WHERE billing_provider = 'phonepe' AND status IN ('created','active','pending')`)
  if (!Number(any?.n)) return out
  const creds = await autopayCreds(opts.store?.tenantId ?? null).catch(() => null)
  if (!creds) {
    console.warn('[autopay] store has PhonePe Autopay subscriptions but no PhonePe account', { tenantId: opts.store?.tenantId ?? null })
    return out
  }
  const guard = async (what: string, id: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err: any) {
      out.errors++
      console.warn(`[autopay] ${what} failed`, id, err?.message ?? err)
    }
  }

  const setups = await queryMany<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM subscriptions WHERE billing_provider = 'phonepe' AND status = 'created' AND created_at < NOW() - INTERVAL '2 minutes' ORDER BY created_at LIMIT 200`
  )
  for (const s of setups) {
    await guard('setup sync', s.id, async () => {
      const v = await syncAutopaySetup(s.id, { store: opts.store })
      if (v.setup === 'active') out.setups++
      else if (v.setup === 'failed') out.abandoned++
      else if (now.getTime() - new Date(s.created_at).getTime() > SETUP_ABANDON_MS) {
        await query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'created'`, [s.id])
        out.abandoned++
      }
    })
  }

  const open = await queryMany<{ id: string }>(
    `SELECT r.id FROM subscription_redemptions r WHERE r.status IN ('notifying','notified','executing') ORDER BY r.due_at LIMIT 500`
  )
  for (const r of open) {
    await guard('redemption', r.id, async () => {
      const res = await advanceRedemption(r.id, opts.store, now)
      if (res === 'completed') out.completed++
      else if (res === 'failed') out.failed++
      else if (res === 'executing') out.executed++
    })
  }

  const due = await queryMany<SubscriptionRow>(
    `SELECT s.* FROM subscriptions s
      WHERE s.billing_provider = 'phonepe' AND s.status = 'active' AND s.current_end IS NOT NULL AND s.current_end <= $1
        AND NOT EXISTS (SELECT 1 FROM subscription_redemptions r WHERE r.subscription_id = s.id AND r.status IN ('notifying','notified','executing'))
      ORDER BY s.current_end LIMIT 500`,
    [new Date(now.getTime() + NOTIFY_LEAD_MS)]
  )
  for (const row of due) {
    await guard('renewal', row.id, async () => {
      let sub = row
      const first = nextRenewalStep({ ...sub, phonepe_mandate_state: 'ACTIVE' }, now)
      if (first.kind === 'wait') return
      if (first.kind === 'end') {
        await cancelMandate(creds, sub.phonepe_merchant_subscription_id!).catch(() => {})
        await query(`UPDATE subscriptions SET phonepe_mandate_state = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [sub.id])
        await applySubscriptionState(sub.id, first.as, null)
        out.ended++
        return
      }
      // The customer may have paused or revoked the mandate in their UPI app since the last cycle.
      sub = await applyMandateState(sub, await mandateStatus(creds, sub.phonepe_merchant_subscription_id!))
      const step = nextRenewalStep(sub, now)
      if (step.kind !== 'notify') return
      if (await startRedemption(sub, step.cycle, step.dueAt, creds, now)) out.notified++
    })
  }
  return out
}

/** Customer / admin cancel. The mandate ends at once; a cycle-end cancel keeps the paid period. */
export async function cancelAutopaySubscription(sub: SubscriptionRow, atCycleEnd: boolean, store: Store): Promise<void> {
  const creds = await credsFor(store)
  if (sub.phonepe_merchant_subscription_id && !['CANCELLED', 'REVOKED'].includes(String(sub.phonepe_mandate_state ?? '').toUpperCase())) {
    try {
      await cancelMandate(creds, sub.phonepe_merchant_subscription_id)
    } catch (err) {
      // Already gone on PhonePe's side is fine; anything else must not leave a live mandate behind.
      const m = await mandateStatus(creds, sub.phonepe_merchant_subscription_id).catch(() => null)
      if (!m || !['CANCELLED', 'REVOKED', 'EXPIRED', 'FAILED', 'CANCEL_IN_PROGRESS'].includes(m.state)) throw err
    }
  }
  await closeOpenRedemptions(sub.id, 'subscription cancelled')
  const atEnd = atCycleEnd && sub.status === 'active' && !!sub.current_end && new Date(sub.current_end).getTime() > Date.now()
  await query(
    `UPDATE subscriptions SET phonepe_mandate_state = 'CANCELLED', cancel_at_cycle_end = $2, cancel_requested_at = COALESCE(cancel_requested_at, NOW()), updated_at = NOW() WHERE id = $1`,
    [sub.id, atEnd]
  )
  if (!atEnd) await applySubscriptionState(sub.id, 'cancelled', null)
}

/** PhonePe has no merchant pause: we stop renewing (no notification, no debit) and keep the mandate. */
export async function pauseAutopaySubscription(sub: SubscriptionRow): Promise<SubscriptionRow> {
  await closeOpenRedemptions(sub.id, 'subscription paused')
  return (await applySubscriptionState(sub.id, 'paused', null)).row
}

/** Resume a paused subscription, or retry one whose renewal failed; the next run notifies the cycle again. */
export async function resumeAutopaySubscription(sub: SubscriptionRow, store: Store): Promise<SubscriptionRow> {
  const creds = await credsFor(store)
  const mandate = await mandateStatus(creds, sub.phonepe_merchant_subscription_id!)
  if (mandate.state !== 'ACTIVE') {
    await saveMandate(sub.id, mandate)
    throw new SubscriptionError(
      mandate.state === 'PAUSED' ? 'The UPI mandate is paused in your UPI app. Resume it there first.' : 'The UPI mandate is no longer active. Please start a new subscription.',
      409
    )
  }
  await saveMandate(sub.id, mandate)
  return (await applySubscriptionState(sub.id, 'active', null)).row
}
