import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { flagshipScope, runInTenant, scopeForTenantId, type WebhookTenant } from '@/lib/payments/webhook-tenant'
import { verifyCallbackAuth } from './phonepe'
import { platformPhonePeCreds, storedPhonePeCreds } from './creds'
import { applyPhonePeRefundState, settleUpiIntent } from './settle'
import { handleAutopayWebhook, isAutopayEvent } from './autopay-webhook'

/**
 * PhonePe webhooks. The platform account's callback hits /api/webhooks/upi with no store host; a
 * store's own account hits /api/webhooks/upi/[tenant]. The body's state is never trusted: every
 * checkout event re-reads the order status and settles from that. Autopay (subscription) events go
 * to autopay-webhook.ts.
 */

export type PhonePeWebhookScope = 'platform' | { tenantId: string }

export interface WebhookResult {
  status: 200 | 400 | 404 | 503
  body: Record<string, unknown>
}

const ok = (what: string, extra: Record<string, unknown> = {}): WebhookResult => ({ status: 200, body: { status: what, ...extra } })

async function webhookCreds(scope: PhonePeWebhookScope): Promise<{ username?: string; password?: string } | 'retry'> {
  if (scope === 'platform') {
    const p = await platformPhonePeCreds()
    return { username: p?.webhookUsername ?? process.env.PHONEPE_WEBHOOK_USERNAME, password: p?.webhookPassword ?? process.env.PHONEPE_WEBHOOK_PASSWORD }
  }
  try {
    // The store's own credentials only, never the platform's.
    const own = await storedPhonePeCreds(scope.tenantId)
    return { username: own?.webhookUsername, password: own?.webhookPassword }
  } catch {
    return 'retry'
  }
}

/** Which DB a checkout event's intent lives in: udf1 names the store, 'cp' the control plane / flagship. */
async function scopeForEvent(scope: PhonePeWebhookScope, udf1: string | undefined): Promise<WebhookTenant | null | 'retry'> {
  if (scope !== 'platform') {
    if (udf1 && udf1 !== 'cp' && udf1 !== scope.tenantId) return null // another store's order on this store's webhook
    try {
      return await scopeForTenantId(scope.tenantId)
    } catch {
      return 'retry'
    }
  }
  if (!udf1 || udf1 === 'cp') return flagshipScope()
  try {
    return await scopeForTenantId(udf1)
  } catch {
    return 'retry'
  }
}

export async function handlePhonePeCallback(input: { rawBody: string; authHeader: string | null; scope: PhonePeWebhookScope }): Promise<WebhookResult> {
  const creds = await webhookCreds(input.scope)
  if (creds === 'retry') return { status: 503, body: { error: 'retry' } }
  if (!creds.username || !creds.password) return { status: input.scope === 'platform' ? 400 : 404, body: { error: 'Webhook not configured' } }
  if (!verifyCallbackAuth(input.authHeader, creds.username, creds.password)) return { status: 400, body: { error: 'Invalid authorization' } }

  let event: any
  try {
    event = JSON.parse(input.rawBody)
  } catch {
    return { status: 400, body: { error: 'Invalid payload' } }
  }
  const type = String(event?.event ?? event?.type ?? '')
  const payload = event?.payload ?? {}

  if (type.startsWith('checkout.')) {
    const moid = String(payload?.merchantOrderId ?? payload?.merchantId ?? '').trim()
    if (!moid) return ok('ignored', { reason: 'no merchantOrderId' })
    const udf1 = payload?.metaInfo?.udf1 ? String(payload.metaInfo.udf1) : undefined
    const store = await scopeForEvent(input.scope, udf1)
    if (store === 'retry') return { status: 503, body: { error: 'retry' } }
    if (!store) return ok('ignored', { reason: 'unknown store' })
    try {
      const scoped = { tenantId: store.tenantId, slug: store.slug }
      // An Autopay mandate's setup order is a checkout order too (matched by its id); the rest are payment intents.
      const autopay = await runInTenant(store, () => handleAutopayWebhook(event, { store: scoped }))
      if (autopay.handled) return ok('handled')
      const intent = await runInTenant(store, () => settleUpiIntent(moid, { store: scoped }))
      return ok(intent ? intent.status : 'ignored', intent ? { intentId: intent.id } : { reason: 'unknown intent' })
    } catch (err: any) {
      console.error('[webhook:upi] settle failed', { type, moid, err: err?.message ?? err })
      return { status: 503, body: { error: 'retry' } }
    }
  }

  if (isAutopayEvent(type)) {
    const udf1 = payload?.metaInfo?.udf1 ? String(payload.metaInfo.udf1) : undefined
    const store = await scopeForEvent(input.scope, udf1)
    if (store === 'retry') return { status: 503, body: { error: 'retry' } }
    if (!store) return ok('ignored', { reason: 'unknown store' })
    try {
      const r = await runInTenant(store, () => handleAutopayWebhook(event, { store: { tenantId: store.tenantId, slug: store.slug } }))
      return r.handled ? ok('handled') : ok('ignored', { reason: `unhandled event ${type}` })
    } catch (err: any) {
      console.error('[webhook:upi] autopay event failed', { type, err: err?.message ?? err })
      return { status: 503, body: { error: 'retry' } }
    }
  }

  if (type.startsWith('pg.refund.')) {
    const merchantRefundId = String(payload?.merchantRefundId ?? '').trim()
    const state = String(payload?.state ?? (type.endsWith('completed') ? 'COMPLETED' : type.endsWith('failed') ? 'FAILED' : 'PENDING')).toUpperCase()
    if (!merchantRefundId || (state !== 'COMPLETED' && state !== 'FAILED')) return ok('ignored')
    // The refund record is in the store's DB: this store's for its own webhook, the flagship's for the platform's.
    const store = input.scope === 'platform' ? flagshipScope() : await scopeForEvent(input.scope, undefined)
    if (store === 'retry') return { status: 503, body: { error: 'retry' } }
    if (!store) return ok('ignored')
    try {
      await runInTenant(store, async () => {
        const rec = await queryOne<{ razorpay_payment_id: string; amount: string }>(`SELECT razorpay_payment_id, amount FROM payment_refunds WHERE razorpay_refund_id = $1`, [merchantRefundId])
        if (!rec) return
        const utr = payload?.paymentDetails?.[0]?.rail?.utr ?? payload?.utr ?? null
        await applyPhonePeRefundState(merchantRefundId, state, { paymentId: rec.razorpay_payment_id, amountPaise: Math.round(Number(rec.amount) * 100), utr }, { tenantId: store.tenantId, slug: store.slug })
      })
      return ok('handled')
    } catch (err: any) {
      console.error('[webhook:upi] refund update failed', { type, merchantRefundId, err: err?.message ?? err })
      return { status: 503, body: { error: 'retry' } }
    }
  }
  return ok('ignored', { reason: `unhandled event ${type}` })
}
