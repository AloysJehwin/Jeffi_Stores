import 'server-only'
import QRCode from 'qrcode'
import { query } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { createPayment, PHONEPE_EXPIRE_AFTER_SEC } from './phonepe'
import { upiPayUri } from './pay-uri'
import { resolveUpiProvider, upiStatus } from './creds'
import { createUpiIntent, platformDb, storeDb, updateUpiIntent, WALLET_PURPOSES, type UpiDb, type UpiIntent, type UpiPurpose, type UpiRefs } from './intents'
import { advanceVpa } from './upg'

/**
 * Starts a UPI payment on the collecting merchant's provider: a PhonePe hosted checkout, or a UPG
 * session (queue → pay the merchant's UPI ID → bank alert). The amount is computed by the caller
 * (handlers.ts) exactly as the Razorpay create-order path does; this records the intent and wires it
 * to what it pays for.
 */

export type UpiStore = { tenantId: string; slug?: string | null } | null

export interface StartUpiInput {
  purpose: UpiPurpose
  amountPaise: number
  /** The store the payment is for; null is the flagship. For ecom wallet top-ups: the owner's tenant. */
  tenant: UpiStore
  refs: UpiRefs
  /** Where the return page sends the customer afterwards (a same-site path). */
  returnTo: string
  /** Origin of the service whose /pay/upi/[intentId]/return page PhonePe should redirect to. */
  redirectBase: string
  user?: { id?: string | null; name?: string | null } | null
  /** Shown on the hosted page and the UPG screen; defaults to the store's name. */
  payeeName?: string
  /** Payment reference in the UPI note (an order number); defaults to the merchant order id. */
  reference?: string
}

export type StartUpiResult =
  | { intentId: string; mode: 'phonepe'; amountPaise: number; redirectUrl: string }
  | { intentId: string; mode: 'upg'; amountPaise: number; checkoutUrl: string }

export class UpiUnavailableError extends Error {
  constructor(message = 'UPI payments are not available for this store') {
    super(message)
    this.name = 'UpiUnavailableError'
  }
}

const inr = (paise: number) => (paise / 100).toFixed(2)

/** Where an intent of this purpose lives: the flagship DB for payments made to the platform, else the request's store. */
export const dbForPurpose = (purpose: UpiPurpose): UpiDb => (WALLET_PURPOSES.includes(purpose) ? platformDb : storeDb)

const qrCache = new Map<string, string>()

/** What the UPG screen shows while the payer holds the UPI ID: the deep link (tn = store name + short reference) and its QR. */
export async function upgPayPayload(intent: UpiIntent): Promise<{ upiUri: string; qrDataUrl: string } | null> {
  if (!intent.receiving_vpa) return null
  const name = intent.refs.payeeName || 'Store'
  const ref = (intent.refs.reference || intent.merchant_order_id.slice(-8)).slice(0, 20)
  const upiUri = upiPayUri({ vpa: intent.receiving_vpa, payeeName: name, amountPaise: intent.amount_paise, reference: `${name.slice(0, 18)} ${ref}` })
  let qrDataUrl = qrCache.get(upiUri)
  if (!qrDataUrl) {
    qrDataUrl = await QRCode.toDataURL(upiUri, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
    if (qrCache.size > 500) qrCache.clear()
    qrCache.set(upiUri, qrDataUrl)
  }
  return { upiUri, qrDataUrl }
}

/** udf1 of the PhonePe order: which DB holds the intent ('cp' = the flagship DB). */
export const udf1For = (tenant: UpiStore, purpose?: UpiPurpose) => (tenant && !isFlagship(tenant) && !(purpose && WALLET_PURPOSES.includes(purpose)) ? tenant.tenantId : 'cp')

/** Ties the intent to what it pays for, so settlement finds it by the merchant order id. */
async function attachToPurpose(intent: UpiIntent, provider: 'phonepe' | 'upg') {
  const moid = intent.merchant_order_id
  const r = intent.refs
  switch (intent.purpose) {
    case 'order_draft':
      if (!r.draftToken || !r.userId) throw new Error('draftToken and userId are required for an order draft')
      await query(
        `INSERT INTO pending_payment_intents (razorpay_order_id, draft_token, user_id, amount_paise)
         VALUES ($1, $2, $3, $4) ON CONFLICT (razorpay_order_id) DO NOTHING`,
        [moid, r.draftToken, r.userId, intent.amount_paise]
      )
      return
    case 'order':
      if (!r.orderId) throw new Error('orderId is required')
      await query(
        `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
         VALUES ($1, 'upi', $2, $3, $4, 'pending', $5) ON CONFLICT (transaction_id) DO NOTHING`,
        [r.orderId, provider === 'phonepe' ? 'phonepe' : 'upi_upg', moid, inr(intent.amount_paise), JSON.stringify({ merchant_order_id: moid, upi_intent_id: intent.id, purpose: 'order' })]
      )
      return
    case 'order_adjustment':
      if (!r.adjustmentId) throw new Error('adjustmentId is required')
      await query(
        `UPDATE order_adjustments SET status = 'awaiting_payment', razorpay_order_id = $1, updated_at = NOW()
          WHERE id = $2 AND status IN ('pending_customer', 'awaiting_payment')`,
        [moid, r.adjustmentId]
      )
      return
    case 'variant_change':
      if (!r.requestId) throw new Error('requestId is required')
      await query(
        `UPDATE variant_change_requests SET status = 'awaiting_payment', razorpay_order_id = $1, updated_at = NOW()
          WHERE id = $2 AND status IN ('pending_customer', 'awaiting_payment')`,
        [moid, r.requestId]
      )
      return
    default:
      return
  }
}

export async function startUpiPayment(input: StartUpiInput): Promise<StartUpiResult> {
  if (!(input.amountPaise >= 100)) throw new UpiUnavailableError('UPI payments need at least ₹1')
  const wallet = WALLET_PURPOSES.includes(input.purpose)
  const tenantId = input.tenant?.tenantId ?? null
  // Wallet top-ups pay the platform, whatever the store's own arrangement.
  const merchant = wallet || isFlagship(input.tenant) ? null : tenantId
  const db = dbForPurpose(input.purpose)
  if ((await upiStatus(merchant)).killed) throw new UpiUnavailableError()
  const choice = await resolveUpiProvider(merchant)
  if (choice.provider === 'none') throw new UpiUnavailableError(merchant ? 'This store has no UPI ID to pay to' : 'UPI is not set up')
  const payeeName = input.payeeName || (await getStoreIdentity().then(i => i.name).catch(() => 'Store'))
  const base = input.redirectBase.replace(/\/$/, '')

  if (choice.provider === 'upg') {
    const intent = await createUpiIntent(
      {
        tenantId,
        provider: 'upg',
        purpose: input.purpose,
        amountPaise: input.amountPaise,
        refs: { ...input.refs, payeeName, ...(input.reference ? { reference: input.reference } : {}) },
        returnTo: input.returnTo,
        receivingVpa: choice.vpa.toLowerCase(),
      },
      db
    )
    await attachToPurpose(intent, 'upg')
    await advanceVpa(intent.receiving_vpa, db)
    return { intentId: intent.id, mode: 'upg', amountPaise: intent.amount_paise, checkoutUrl: `${base}/pay/upi/${intent.id}` }
  }

  const creds = choice.creds
  const expiresAt = new Date(Date.now() + PHONEPE_EXPIRE_AFTER_SEC * 1000)
  const intent = await createUpiIntent({ tenantId, provider: 'phonepe', purpose: input.purpose, amountPaise: input.amountPaise, refs: input.refs, returnTo: input.returnTo, expiresAt }, db)
  await attachToPurpose(intent, 'phonepe')
  try {
    const pay = await createPayment(creds, {
      merchantOrderId: intent.merchant_order_id,
      amountPaise: intent.amount_paise,
      redirectUrl: `${base}/pay/upi/${intent.id}/return`,
      message: `${payeeName} — ${input.reference || intent.merchant_order_id}`.slice(0, 120),
      metaInfo: { udf1: udf1For(input.tenant, input.purpose), udf2: input.purpose, udf3: intent.id },
      expireAfter: PHONEPE_EXPIRE_AFTER_SEC,
    })
    await updateUpiIntent(
      intent.id,
      {
        provider_order_id: pay.orderId || null,
        redirect_url: pay.redirectUrl,
        expires_at: pay.expireAt && pay.expireAt > 0 ? new Date(pay.expireAt > 1e12 ? pay.expireAt : pay.expireAt * 1000) : expiresAt,
      },
      db
    )
    return { intentId: intent.id, mode: 'phonepe', amountPaise: intent.amount_paise, redirectUrl: pay.redirectUrl }
  } catch (e: any) {
    await updateUpiIntent(intent.id, { error_code: String(e?.message ?? e?.code ?? 'create_failed').slice(0, 120) }, db).catch(() => {})
    await db.query(`UPDATE upi_payment_intents SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [intent.id]).catch(() => {})
    throw e
  }
}

export { upiPayUri } from './pay-uri'
