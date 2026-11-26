import 'server-only'
import { query, queryMany, queryOne, resolveRequestTenant, withTransaction } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { cropRazorpayQr } from '@/lib/payments/upi-qr'
import { recordPaymentDetails, routeCapturedPayment, type Store } from '@/lib/payments/capture'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { KINDS, resultLinks } from './kinds'
import {
  QR_INTENT_TTL_MS,
  QrIntentError,
  type QrIntentActor,
  type QrIntentKind,
  type QrIntentResult,
  type QrIntentRow,
  type QrIntentStatus,
} from './types'

export * from './types'

/**
 * QR-first admin sales. The admin gets a one-time, fixed-amount Razorpay QR for an invoice, a quotation conversion,
 * a draft finalise or a cash sale; the document is created from the stored payload only once Razorpay confirms the
 * payment (qr_code.credited, payment.captured, the poll or the sweep), then settled like any store payment.
 * Every path goes through markQrIntentPaid (once per payment) and finaliseQrIntent (row-locked, once per intent).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A poll asks Razorpay at most this often; a paid intent nobody finalised for this long is picked up by the poll.
const CHECK_EVERY_SEC = 10
const STUCK_PAID_MS = 15_000
// Razorpay wants close_by at least 15 minutes out; the expiry closes the QR itself.
const CLOSE_BY_SLACK_SEC = 120

const inr = (paise: unknown) => Number(paise) / 100
const msg = (e: any) => String(e?.error?.description || e?.message || e || 'unknown error').slice(0, 500)

async function currentStore(): Promise<Store> {
  const t = await resolveRequestTenant()
  return t ? { tenantId: t.tenantId, slug: t.slug } : null
}

async function rzp() {
  return (await getRazorpayInstanceFor((await resolveRequestTenant())?.tenantId)).instance as any
}

const load = (id: string) => queryOne<QrIntentRow>(`SELECT * FROM payment_intents WHERE id = $1`, [id])

export async function getQrIntent(id: string): Promise<QrIntentRow | null> {
  return UUID.test(id) ? load(id) : null
}

/** Validates the payload with a dry run of the real create call, then makes the intent and its QR. */
export async function createQrIntent(opts: {
  kind: QrIntentKind
  payload: unknown
  actor: QrIntentActor
}): Promise<{ intentId: string; qrImageUrl: string; amount: number; expiresAt: string }> {
  const raw = opts.payload
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new QrIntentError('payload must be an object')
  const v = await KINDS[opts.kind].validate(raw as Record<string, any>, opts.actor)
  if (!(v.amountPaise > 0)) throw new QrIntentError('Nothing to pay: the total is ₹0')

  const expiresAt = new Date(Date.now() + QR_INTENT_TTL_MS)
  const row = await queryOne<{ id: string }>(
    `INSERT INTO payment_intents (kind, payload, amount_paise, actor, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [opts.kind, JSON.stringify(v.payload), v.amountPaise, JSON.stringify(opts.actor), opts.actor.adminId, expiresAt]
  )
  const id = row!.id
  const tenant = await resolveRequestTenant()
  let qr: any
  try {
    const { instance } = await getRazorpayInstanceFor(tenant?.tenantId)
    qr = await (instance as any).qrCode.create({
      type: 'upi_qr',
      name: v.label.slice(0, 60),
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: v.amountPaise,
      description: `${await currentBrandNameAsync()} ${v.label}`.slice(0, 250),
      close_by: Math.floor(expiresAt.getTime() / 1000) + CLOSE_BY_SLACK_SEC,
      notes: {
        payment_intent_id: id,
        kind: opts.kind,
        ...(tenant?.tenantId ? { tenant_id: tenant.tenantId } : {}),
        ...(tenant?.slug ? { tenant_slug: tenant.slug } : {}),
      },
    })
  } catch (e) {
    await query(`UPDATE payment_intents SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [id, `QR not created: ${msg(e)}`])
    throw new QrIntentError(`Couldn't create the Razorpay QR: ${msg(e)}`, 502)
  }
  const qrImageUrl = await cropRazorpayQr(qr.image_url).catch(() => qr.image_url as string)
  await query(`UPDATE payment_intents SET razorpay_qr_id = $2, qr_image_url = $3, updated_at = NOW() WHERE id = $1`, [id, qr.id, qrImageUrl])
  return { intentId: id, qrImageUrl, amount: inr(v.amountPaise), expiresAt: expiresAt.toISOString() }
}

export interface QrIntentView {
  id: string
  kind: QrIntentKind
  status: QrIntentStatus
  amount: number
  expiresAt: string
  qrImageUrl: string | null
  error?: string
  resultRef?: string
  resultUrl?: string
  invoiceUrl?: string
  invoiceNumber?: string | null
}

/** What the poll answers. */
export async function qrIntentView(row: QrIntentRow): Promise<QrIntentView> {
  const v: QrIntentView = {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amount: inr(row.amount_paise),
    expiresAt: new Date(row.expires_at).toISOString(),
    qrImageUrl: row.qr_image_url,
  }
  if (row.error && (row.status === 'failed' || row.status === 'cancelled' || row.status === 'expired')) v.error = row.error
  if (row.status === 'finalised' && row.result_ref) {
    Object.assign(v, { resultRef: row.result_ref }, resultLinks(row.kind, row.result_ref))
    const table = row.kind === 'cash_sale' ? 'cash_sales' : 'orders'
    v.invoiceNumber = (await queryOne<{ n: string | null }>(`SELECT invoice_number AS n FROM ${table} WHERE id = $1`, [row.result_ref]).catch(() => null))?.n ?? null
  }
  return v
}

/** The poll: reads the intent, asks Razorpay now and then, expires it when due and finalises one left paid. */
export async function pollQrIntent(id: string): Promise<QrIntentRow | null> {
  let row = await getQrIntent(id)
  if (!row) return null
  if (row.status === 'pending') row = (await refreshPending(row)) ?? row
  if (row.status === 'paid' && (!row.paid_at || Date.now() - new Date(row.paid_at).getTime() > STUCK_PAID_MS))
    row = (await finaliseQrIntent(row.id, { skipLocked: true })) ?? row
  return row
}

/** The QR's captured payment, if Razorpay has one (null when none, or Razorpay can't be asked). */
async function capturedQrPayment(qrId: string | null): Promise<any | null> {
  if (!qrId) return null
  try {
    const list = await (await rzp()).qrCode.fetchAllPayments(qrId)
    return (Array.isArray(list?.items) ? list.items : []).find((p: any) => p.status === 'captured') ?? null
  } catch (e) {
    console.warn('[qr-intents] payment lookup failed', qrId, msg(e))
    return null
  }
}

async function closeQr(qrId: string | null) {
  if (!qrId) return
  try {
    await (await rzp()).qrCode.close(qrId)
  } catch (e) {
    // Already closed (paid, expired) is fine.
    if (!/closed|already/i.test(msg(e))) console.warn('[qr-intents] QR close failed', qrId, msg(e))
  }
}

/** A pending intent: a payment Razorpay already took is applied; past its expiry it is closed and expired. */
async function refreshPending(row: QrIntentRow, opts: { force?: boolean } = {}): Promise<QrIntentRow | null> {
  const expired = new Date(row.expires_at).getTime() <= Date.now()
  if (!expired && !opts.force) {
    const turn = await queryOne(
      `UPDATE payment_intents SET checked_at = NOW() WHERE id = $1 AND status = 'pending'
         AND (checked_at IS NULL OR checked_at < NOW() - make_interval(secs => $2)) RETURNING id`,
      [row.id, CHECK_EVERY_SEC]
    )
    if (!turn) return row
  }
  const payment = await capturedQrPayment(row.razorpay_qr_id)
  if (payment) {
    await markQrIntentPaid(row.id, payment)
    return (await finaliseQrIntent(row.id)) ?? load(row.id)
  }
  if (expired) {
    await closeQr(row.razorpay_qr_id)
    await query(`UPDATE payment_intents SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [row.id])
    return load(row.id)
  }
  return row
}

/** Cancel: closes the QR first, so a payment that landed before the close still finalises. */
export async function cancelQrIntent(id: string): Promise<QrIntentRow | null> {
  const row = await getQrIntent(id)
  if (!row || row.status !== 'pending') return row
  await closeQr(row.razorpay_qr_id)
  const payment = await capturedQrPayment(row.razorpay_qr_id)
  if (payment) {
    await markQrIntentPaid(id, payment)
    return (await finaliseQrIntent(id)) ?? load(id)
  }
  await query(`UPDATE payment_intents SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [id])
  return load(id)
}

/**
 * Records the payment on an open intent, once (null when it already has one). Expired still counts: Razorpay only
 * takes a payment on an open QR. A cancelled intent, or a wrong amount, fails: nothing is created from it.
 */
export async function markQrIntentPaid(id: string, payment: any): Promise<QrIntentStatus | null> {
  if (!payment?.id || (payment.status && payment.status !== 'captured')) return null
  const paid = Number(payment.amount) || 0
  const r = await queryOne<QrIntentRow>(
    `UPDATE payment_intents SET
       status = CASE WHEN status = 'cancelled' OR amount_paise <> $3::bigint THEN 'failed' ELSE 'paid' END,
       error = CASE
         WHEN status = 'cancelled' THEN 'Paid after the QR was cancelled, so nothing was created'
         WHEN amount_paise <> $3::bigint THEN 'Paid ₹' || ($3::bigint::numeric / 100) || ' but ₹' || (amount_paise::numeric / 100) || ' was due, so nothing was created'
         ELSE NULL END,
       razorpay_payment_id = $2, payment = $4, paid_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'expired', 'cancelled') AND razorpay_payment_id IS NULL
     RETURNING *`,
    [id, payment.id, paid, JSON.stringify(payment)]
  )
  if (r?.status === 'failed') notifyFailed(r)
  return r?.status ?? null
}

/**
 * Creates the document of a paid intent, once: the row lock serialises racing finalisers, and a payment that
 * already made its document (a crash after the create) is adopted, not repeated. A create that fails leaves the
 * intent failed with the reason; the payment stays recorded and nothing is refunded.
 */
export async function finaliseQrIntent(id: string, opts: { store?: Store; skipLocked?: boolean } = {}): Promise<QrIntentRow | null> {
  const out = await withTransaction(async client => {
    const r = await client.query(`SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE${opts.skipLocked ? ' SKIP LOCKED' : ''}`, [id])
    const row = r.rows[0] as QrIntentRow | undefined
    if (!row || row.status !== 'paid' || !row.razorpay_payment_id) return { row: row ?? null, result: null }
    const kind = KINDS[row.kind]
    const qr = { razorpayPaymentId: row.razorpay_payment_id, razorpayQrId: row.razorpay_qr_id, amountPaise: Number(row.amount_paise), intentId: row.id }
    let result: QrIntentResult | null = null
    let error = ''
    try {
      result = (await kind.existing(qr.razorpayPaymentId)) ?? (await kind.finalise(row, qr))
    } catch (e) {
      result = await kind.existing(qr.razorpayPaymentId).catch(() => null)
      if (!result) error = msg(e)
    }
    const upd = result
      ? await client.query(
          `UPDATE payment_intents SET status = 'finalised', result_ref = $2, error = NULL, finalised_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
          [id, result.id]
        )
      : await client.query(`UPDATE payment_intents SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, error])
    return { row: upd.rows[0] as QrIntentRow, result, changed: true }
  })
  if (out.row && 'changed' in out) {
    if (out.result) await afterFinalise(out.row, out.result, opts.store)
    else notifyFailed(out.row)
  }
  return out.row
}

/** What a paid creation does after it: the payment's details and the store's Route transfer. */
async function afterFinalise(row: QrIntentRow, result: QrIntentResult, store?: Store) {
  const s = store !== undefined ? store : await currentStore().catch(() => null)
  const paymentId = row.razorpay_payment_id!
  if (row.kind !== 'cash_sale' && row.payment) {
    const isOwn = s && !isFlagship(s) ? (await resolveRazorpayCreds(s.tenantId).catch(() => null))?.isOwn : false
    await recordPaymentDetails(row.payment, { account: isOwn ? 'own' : 'platform', capturedAt: new Date() }).catch(() => {})
  }
  await routeCapturedPayment({ store: s, paymentId, totalAmountInr: inr(row.amount_paise), orderId: result.id, orderRef: result.ref }).catch(e =>
    console.error('[qr-intents] settlement failed', row.id, msg(e))
  )
}

const LABEL: Record<QrIntentKind, string> = {
  invoice: 'invoice',
  quotation_convert: 'invoice',
  invoice_draft_finalise: 'invoice',
  cash_sale: 'cash sale',
}

function notifyFailed(row: QrIntentRow) {
  createAdminNotification({
    type: 'qr_intent_failed',
    category: 'finance',
    title: `Rs. ${inr(row.amount_paise).toFixed(2)} paid by UPI QR, but the ${LABEL[row.kind]} wasn't created`,
    message: `${row.error}. Create it by hand, or refund ${row.razorpay_payment_id} from the Razorpay dashboard.`,
    link: row.razorpay_payment_id ? `https://dashboard.razorpay.com/app/payments/${row.razorpay_payment_id}` : null,
    entityType: 'payment_intent',
    entityId: row.id,
    severity: 'critical',
    scope: 'financial:read',
  }).catch(() => {})
}

/**
 * A Razorpay QR payment in the store this runs in (the webhook wraps it in runInTenant). Our QRs name their intent
 * in their notes; 'unmatched' when they don't, so the caller tries the invoice-QR orders.
 */
export async function applyQrIntentPayment(qr: any, payment: any, store: Store): Promise<'paid' | 'already_paid' | 'unmatched'> {
  const noteId = String(qr?.notes?.payment_intent_id ?? '')
  if (!UUID.test(noteId)) return 'unmatched'
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM payment_intents WHERE id = $1 AND (razorpay_qr_id IS NULL OR razorpay_qr_id = $2)`,
    [noteId, qr?.id ?? null]
  )
  if (!row) return 'unmatched'
  const marked = await markQrIntentPaid(row.id, payment)
  await finaliseQrIntent(row.id, { store })
  return marked ? 'paid' : 'already_paid'
}

/** Payments already held by an intent (the sweep's "captured with no order" check skips them). */
export async function intentPaymentIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await queryMany<{ razorpay_payment_id: string }>(
    `SELECT razorpay_payment_id FROM payment_intents WHERE razorpay_payment_id = ANY($1)`,
    [ids]
  ).catch(() => [])
  return new Set(rows.map(r => r.razorpay_payment_id))
}

/** The sweep's pass over this store's open intents: confirmed payments finalise, overdue QRs close, stuck ones retry. */
export async function sweepQrIntents(): Promise<number> {
  const rows = await queryMany<QrIntentRow>(
    `SELECT * FROM payment_intents WHERE status IN ('pending', 'paid') AND created_at > NOW() - INTERVAL '3 days' ORDER BY created_at LIMIT 100`
  )
  let moved = 0
  for (const row of rows) {
    const after = row.status === 'pending' ? await refreshPending(row, { force: true }) : await finaliseQrIntent(row.id, { skipLocked: true })
    if (after && after.status !== row.status) moved++
  }
  return moved
}
