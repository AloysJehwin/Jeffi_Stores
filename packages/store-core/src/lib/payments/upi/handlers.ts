import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryMany, queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { verifyDraftToken, hashCartItems } from '@/lib/orders/order-draft'
import { loadActiveCart, cartSubtotal, cartItemsForHash, validateCouponForUser } from '@/lib/orders/order-commit'
import { loadOpenAdjustment } from '@/lib/orders/adjustment-decision'
import { closeReplyContexts } from '@/lib/replies/context'
import { topupAmounts, topupNotes } from '@/lib/billing/topup'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { PhonePeError } from './phonepe'
import { upiAvailable, walletUpiAvailable } from './creds'
import { getUpiIntent, listUpiIntents, platformDb, storeDb, UPI_INTENT_STATUSES, UPI_PURPOSES, type UpiDb, type UpiIntent, type UpiIntentStatus, type UpiPurpose, type UpiRefs } from './intents'
import { startUpiPayment, upgPayPayload, UpiUnavailableError, type UpiStore } from './service'
import { confirmUpgUtr, decideUpgUtr, settleUpiIntent, UpiConfirmError } from './settle'
import { advanceVpa, markCancelled, markProcessing, observationSuggestions, queueState } from './upg'
import { handlePhonePeCallback } from './webhook'

/**
 * HTTP handlers for UPI payments (docs/plans/UPI_UPG_V2.md §4). Each service's route authenticates
 * and passes who is asking; everything else lives here. Customer routes work on the store's intents;
 * the admin and owner wallet routes on the platform's, which live in the flagship DB.
 */

export type UpiAuth =
  | { kind: 'customer'; userId: string; isBusiness?: boolean }
  | { kind: 'admin'; adminId: string }
  | { kind: 'owner'; ownerId: string; tenant: { id: string; slug?: string | null }; tenantIds?: string[] }

export interface UpiHandlerOptions {
  /** Path prefix of this service's return page: '' (storefront), '/business', '/admin', '/ecom'. */
  returnPrefix?: string
  /** Runs once a status read finds the intent completed (the ecom portal starts a waiting store). */
  onCompleted?: (intent: UpiIntent) => Promise<unknown>
}

const StartSchema = z.object({
  purpose: z.enum(UPI_PURPOSES as [UpiPurpose, ...UpiPurpose[]]),
  draftToken: z.string().nullish(),
  orderId: zNonEmpty.nullish(),
  adjustmentId: zNonEmpty.nullish(),
  requestId: zNonEmpty.nullish(),
  amountInr: z.coerce.number().positive().nullish(),
  returnTo: z.string().max(500).nullish(),
})

const err = (error: string, status: number) => NextResponse.json({ error }, { status })
const dbFor = (auth: UpiAuth): UpiDb => (auth.kind === 'customer' ? storeDb : platformDb)

/** Only a same-site path survives; anything else falls back. */
const safePath = (v: string | null | undefined, fallback: string) => (v && /^\/(?!\/)[^\s\\]*$/.test(v) ? v : fallback)

function originOf(request: NextRequest): string {
  const first = (v: string | null) => (v ?? '').split(',')[0].trim()
  const host = first(request.headers.get('x-forwarded-host')) || first(request.headers.get('host')) || request.nextUrl.host
  const local = /^(localhost|127\.|\[::1\])/.test(host)
  const proto = first(request.headers.get('x-forwarded-proto')) || (local ? 'http' : 'https')
  return `${proto}://${host}`
}

async function requestStore(): Promise<UpiStore> {
  const t = await resolveRequestTenant()
  return t ? { tenantId: t.tenantId, slug: t.slug } : null
}

type Plan = { amountPaise: number; refs: UpiRefs; returnTo: string; reference?: string } | NextResponse

/** A checkout draft's total, exactly as /api/razorpay/create-order computes it. */
async function planDraft(token: string, userId: string): Promise<Plan> {
  const draft = await verifyDraftToken(token)
  if (!draft) return err('Invalid or expired checkout session', 400)
  if (draft.userId !== userId) return err('Unauthorized', 403)

  let subtotal = 0
  const { gstEnabled } = await getFeatureFlags()
  if (draft.mode === 'cart') {
    const cart = await loadActiveCart(userId)
    if (cart.length === 0) return err('Cart is empty', 400)
    const hash = hashCartItems(cartItemsForHash(cart))
    if (draft.cartHash && draft.cartHash !== hash) return err('Cart changed since checkout was started. Please review and try again.', 409)
    subtotal = cartSubtotal(cart, gstEnabled)
  } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
    subtotal = draft.buyNowItem.price * draft.buyNowItem.qty
  } else {
    return err('Invalid draft', 400)
  }

  let appliedDiscount = 0
  if (draft.couponId) {
    const r = await validateCouponForUser({ couponId: draft.couponId, userId, subtotal })
    if (r.ok) appliedDiscount = r.appliedDiscount
  }
  const total = Math.max(0, subtotal - appliedDiscount - (draft.businessDiscountAmount || 0) + (draft.shippingAmount || 0))
  const amountPaise = Math.round(total * 100)
  if (amountPaise <= 0) return err('Order total must be greater than zero', 400)
  return { amountPaise, refs: { draftToken: token, userId }, returnTo: '/account/orders' }
}

/** An existing unpaid order, with the same ownership rule as create-order. */
async function planOrder(orderId: string, userId: string, isBusiness: boolean): Promise<Plan> {
  let order: any
  if (isBusiness) {
    const u = await queryOne<{ email: string; phone: string | null }>('SELECT email, phone FROM users WHERE id = $1', [userId])
    order = await queryOne(
      `SELECT id, order_number, user_id, total_amount, payment_status, status FROM orders
       WHERE id = $1 AND (
         user_id = $2 OR
         (source = 'business' AND (customer_email = $3 OR ($4::text IS NOT NULL AND customer_phone = $4)))
       )`,
      [orderId, userId, u?.email || '', u?.phone || null]
    )
  } else {
    order = await queryOne('SELECT id, order_number, user_id, total_amount, payment_status, status FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId])
  }
  if (!order) return err('Order not found', 404)
  if (order.payment_status === 'paid') return err('Order is already paid', 400)
  if (order.status === 'cancelled') return err('This order was cancelled and can no longer be paid', 400)
  const amountPaise = Math.round(parseFloat(order.total_amount) * 100)
  return { amountPaise, refs: { orderId: order.id, userId }, returnTo: `/account/orders/${order.id}`, reference: order.order_number }
}

/** The extra owed on an approved product adjustment (confirmAdjustment's collect branch). */
async function planAdjustment(adjId: string, orderId: string | null | undefined, userId: string): Promise<Plan> {
  const oid = orderId || (await queryOne<{ order_id: string }>(`SELECT order_id FROM order_adjustments WHERE id = $1`, [adjId]))?.order_id
  const adj = oid ? await loadOpenAdjustment(adjId, oid) : null
  if (!adj) return err('Change request not found.', 404)
  if (adj.user_id && adj.user_id !== userId) return err('This order does not belong to you.', 403)
  if (adj.status !== 'pending_customer' && adj.status !== 'awaiting_payment') return err('This change is no longer open.', 409)
  if (adj.order_status !== 'confirmed' || adj.awb_number) return err('This order can no longer be changed (it has moved to fulfilment).', 400)
  if (adj.settlement_type !== 'collect') return err('Nothing to collect for this change.', 400)
  const amountPaise = Math.round(Math.abs(Number(adj.net_diff)) * 100)
  if (amountPaise <= 0) return err('Nothing to collect.', 400)
  await closeReplyContexts('orders', adj.order_id, 'order_adjustment').catch(() => {})
  return { amountPaise, refs: { adjustmentId: adjId, orderId: adj.order_id, userId }, returnTo: `/account/orders/${adj.order_id}`, reference: adj.order_number }
}

/** The extra owed on an accepted variant change (variant-change/confirm's collect branch). */
async function planVariantChange(requestId: string | null | undefined, orderId: string | null | undefined, userId: string): Promise<Plan> {
  const vcr = await queryOne<any>(
    `SELECT vcr.*, o.order_number, o.user_id, o.status AS order_status, o.awb_number
       FROM variant_change_requests vcr JOIN orders o ON o.id = vcr.order_id
      WHERE ($1::uuid IS NULL OR vcr.id = $1::uuid) AND ($2::uuid IS NULL OR vcr.order_id = $2::uuid)
        AND vcr.status IN ('pending_customer', 'awaiting_payment')
      ORDER BY vcr.created_at DESC LIMIT 1`,
    [requestId ?? null, orderId ?? null]
  )
  if (!vcr) return err('No pending variant change request for this order.', 404)
  if (vcr.user_id && vcr.user_id !== userId) return err('This order does not belong to you.', 403)
  if (vcr.order_status !== 'confirmed' || vcr.awb_number) return err('This order can no longer be changed (it has moved to fulfilment).', 400)
  if (vcr.settlement_type !== 'collect') return err('Nothing to collect for this change.', 400)
  const amountPaise = Math.round(Math.abs(Number(vcr.price_diff)) * 100)
  if (amountPaise <= 0) return err('Nothing to collect.', 400)
  return { amountPaise, refs: { requestId: vcr.id, orderId: vcr.order_id, userId }, returnTo: `/account/orders/${vcr.order_id}`, reference: vcr.order_number }
}

const CUSTOMER_PURPOSES: UpiPurpose[] = ['order_draft', 'order', 'order_adjustment', 'variant_change']

/** POST /api/payments/upi/start */
export async function handleUpiStart(request: NextRequest, auth: UpiAuth, opts: UpiHandlerOptions = {}): Promise<NextResponse> {
  try {
    const parsed = parseBody(StartSchema, await request.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const prefix = opts.returnPrefix ?? ''
    const redirectBase = `${originOf(request)}${prefix}`

    let plan: Plan
    let tenant: UpiStore
    let payeeName: string | undefined
    if (auth.kind === 'customer') {
      if (!CUSTOMER_PURPOSES.includes(body.purpose)) return err('Unsupported purpose', 400)
      tenant = await requestStore()
      if (!(await upiAvailable(tenant?.tenantId ?? null))) return err('UPI payments are not available', 400)
      if (body.purpose === 'order_draft') {
        if (!body.draftToken) return err('draftToken is required', 400)
        plan = await planDraft(body.draftToken, auth.userId)
      } else if (body.purpose === 'order') {
        if (!body.orderId) return err('orderId is required', 400)
        plan = await planOrder(body.orderId, auth.userId, auth.isBusiness === true)
      } else if (body.purpose === 'order_adjustment') {
        if (!body.adjustmentId) return err('adjustmentId is required', 400)
        plan = await planAdjustment(body.adjustmentId, body.orderId, auth.userId)
      } else {
        if (!body.requestId && !body.orderId) return err('requestId or orderId is required', 400)
        plan = await planVariantChange(body.requestId, body.orderId, auth.userId)
      }
      if (!(plan instanceof NextResponse)) plan.returnTo = `${prefix}${plan.returnTo}`
    } else {
      const purpose: UpiPurpose = auth.kind === 'admin' ? 'wallet_topup' : 'ecom_wallet_topup'
      if (body.purpose !== purpose) return err('Unsupported purpose', 400)
      if (!(await walletUpiAvailable())) return err('UPI payments are not available', 400)
      const amountInr = Number(body.amountInr)
      if (auth.kind === 'admin') {
        tenant = await requestStore()
        if (!tenant?.tenantId || isFlagship(tenant)) return err('No tenant context', 400)
        if (!(amountInr > 0)) return err('amountInr must be positive', 400)
      } else {
        tenant = { tenantId: auth.tenant.id, slug: auth.tenant.slug }
        if (!(amountInr >= 100)) return err('Minimum top-up is ₹100', 400)
      }
      const a = topupAmounts(amountInr)
      plan = {
        amountPaise: Math.round(a.total * 100),
        refs: {
          ...(auth.kind === 'admin' ? { adminId: auth.adminId } : { ownerId: auth.ownerId }),
          notes: topupNotes({ id: tenant.tenantId, slug: tenant.slug }, amountInr),
        },
        returnTo: auth.kind === 'admin' ? '/admin/wallet' : '/ecom/dashboard/wallet',
        reference: 'Wallet top-up',
      }
      payeeName = 'Jeffi Stores'
    }
    if (plan instanceof NextResponse) return plan

    const result = await startUpiPayment({
      purpose: body.purpose,
      amountPaise: plan.amountPaise,
      tenant,
      refs: plan.refs,
      returnTo: safePath(body.returnTo, plan.returnTo),
      redirectBase,
      reference: plan.reference,
      payeeName,
    })
    return NextResponse.json(result)
  } catch (e: any) {
    if (e instanceof UpiUnavailableError) return err(e.message, 400)
    if (e instanceof PhonePeError) {
      console.error('[upi:start] PhonePe refused', { code: e.code, status: e.status, message: e.message })
      return NextResponse.json({ error: e.message, code: e.code ?? null }, { status: 502 })
    }
    return err(e?.message || 'Failed to start the UPI payment', 500)
  }
}

function mayRead(intent: UpiIntent, auth: UpiAuth, store: UpiStore): boolean {
  if (auth.kind === 'customer') return !!intent.refs.userId && intent.refs.userId === auth.userId
  if (auth.kind === 'owner') return intent.purpose === 'ecom_wallet_topup' && (intent.refs.ownerId === auth.ownerId || (!!intent.tenant_id && (auth.tenantIds ?? [auth.tenant.id]).includes(intent.tenant_id)))
  // Staff see their own store's wallet top-ups (they live in the flagship DB beside other stores').
  return intent.purpose === 'wallet_topup' && !!store?.tenantId && intent.tenant_id === store.tenantId
}

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null)

/** GET …/<id> body. UPG adds the queue, the server-side timers and, while the payer holds the UPI ID, what to pay. */
async function view(i: UpiIntent, db: UpiDb) {
  const base = {
    intentId: i.id,
    status: i.status,
    purpose: i.purpose,
    mode: i.provider,
    provider: i.provider,
    amountPaise: i.amount_paise,
    result: i.result ?? (i.refs.orderId ? { orderId: i.refs.orderId } : null),
    returnTo: i.return_to,
    ...(i.status === 'failed' && i.error_code ? { errorCode: i.error_code } : {}),
  }
  if (i.provider !== 'upg') return base
  const live = i.status === 'active' || i.status === 'processing'
  const [q, pay] = await Promise.all([queueState(i, db), live ? upgPayPayload(i) : null])
  return {
    ...base,
    queuePosition: q.queuePosition,
    payExpiresAt: iso(i.pay_expires_at),
    verifyExpiresAt: iso(i.verify_expires_at),
    serverNow: q.serverNow,
    payee: i.receiving_vpa ? { vpa: i.receiving_vpa, name: i.refs.payeeName || 'Store' } : null,
    upiUri: pay?.upiUri ?? null,
    qrDataUrl: pay?.qrDataUrl ?? null,
  }
}

/** Loads an intent the caller may see, with its UPG timers and queue applied as of now. */
async function loadIntent(intentId: string, auth: UpiAuth): Promise<{ intent: UpiIntent; store: UpiStore; db: UpiDb } | null> {
  if (!z.string().uuid().safeParse(intentId).success) return null
  const db = dbFor(auth)
  const store = await requestStore()
  let intent = await getUpiIntent(intentId, db)
  if (!intent || !mayRead(intent, auth, store)) return null
  if (intent.provider === 'upg' && ['queued', 'active', 'processing'].includes(intent.status)) {
    await advanceVpa(intent.receiving_vpa, db)
    intent = (await getUpiIntent(intentId, db)) ?? intent
  }
  return { intent, store, db }
}

/** The store an intent's payment is applied in: the request's own, or the wallet's tenant for platform intents. */
const applyStore = (intent: UpiIntent, store: UpiStore, db: UpiDb): UpiStore => (db.platform ? (intent.tenant_id ? { tenantId: intent.tenant_id } : null) : store)

/** GET /api/payments/upi/[intentId] — settles a pending PhonePe intent first; applies UPG timers and promotion. */
export async function handleUpiStatus(intentId: string, auth: UpiAuth, opts: UpiHandlerOptions = {}): Promise<NextResponse> {
  try {
    const got = await loadIntent(intentId, auth)
    if (!got) return err('Payment not found', 404)
    const { store, db } = got
    let intent = got.intent
    if (intent.status === 'pending' && intent.provider === 'phonepe') {
      // PhonePe being slow or down leaves it pending; the webhook and the sweep still settle it.
      intent = (await settleUpiIntent(intent.id, { store: applyStore(intent, store, db), db }).catch(e => (console.warn('[upi:status] settle failed', intentId, e?.message ?? e), null))) ?? intent
    }
    if (intent.status === 'completed' && opts.onCompleted) await opts.onCompleted(intent).catch(() => {})
    return NextResponse.json(await view(intent, db))
  } catch (e: any) {
    return err(e?.message || 'Could not check the payment', 500)
  }
}

/** POST /api/payments/upi/[intentId]/check — "Payment done — check my payment": active → processing. */
export async function handleUpiCheck(intentId: string, auth: UpiAuth): Promise<NextResponse> {
  try {
    const got = await loadIntent(intentId, auth)
    if (!got) return err('Payment not found', 404)
    const { intent, db } = got
    if (intent.provider !== 'upg') return err('This payment is confirmed by PhonePe', 400)
    if (intent.status === 'active') {
      const moved = await markProcessing(intent.id, db)
      return NextResponse.json(await view(moved ?? (await getUpiIntent(intent.id, db)) ?? intent, db))
    }
    if (intent.status === 'queued') return err('It is not your turn to pay yet', 409)
    // processing / completed / failed / expired: the caller reads the state it is already in.
    return NextResponse.json(await view(intent, db))
  } catch (e: any) {
    return err(e?.message || 'Could not check the payment', 500)
  }
}

/** POST /api/payments/upi/[intentId]/cancel — queued | active → cancelled; the next payer gets the UPI ID. */
export async function handleUpiCancel(intentId: string, auth: UpiAuth): Promise<NextResponse> {
  try {
    const got = await loadIntent(intentId, auth)
    if (!got) return err('Payment not found', 404)
    const { intent, db } = got
    if (intent.provider !== 'upg') return err('This payment cannot be cancelled here', 400)
    if (intent.status === 'cancelled') return NextResponse.json(await view(intent, db))
    if (intent.status !== 'queued' && intent.status !== 'active') return err(`This payment is ${intent.status}`, 409)
    const cancelled = await markCancelled(intent.id, db)
    if (!cancelled) return err('This payment can no longer be cancelled', 409)
    await advanceVpa(cancelled.receiving_vpa, db).catch(() => {})
    return NextResponse.json(await view(cancelled, db))
  } catch (e: any) {
    return err(e?.message || 'Could not cancel the payment', 500)
  }
}

const ConfirmSchema = z.object({ utr: zNonEmpty })

/** POST /api/payments/upi/[intentId]/confirm — the payer's UTR for a UPG payment we did not see (failed / expired). */
export async function handleUpiConfirm(request: NextRequest, intentId: string, auth: UpiAuth): Promise<NextResponse> {
  try {
    const parsed = parseBody(ConfirmSchema, await request.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const got = await loadIntent(intentId, auth)
    if (!got) return err('Payment not found', 404)
    const { intent, store, db } = got
    return NextResponse.json(await view(await confirmUpgUtr(intentId, parsed.data.utr, { store: applyStore(intent, store, db), db }), db))
  } catch (e: any) {
    if (e instanceof UpiConfirmError) return err(e.message, e.status)
    return err(e?.message || 'Could not record the payment', 500)
  }
}

/** POST /api/webhooks/upi (platform account) and /api/webhooks/upi/[tenant] (a store's own; `tenant` is its slug). */
export async function handleUpiWebhook(request: NextRequest, tenantSlug?: string): Promise<NextResponse> {
  const rawBody = await request.text()
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return err('Missing authorization', 400)
  if (!tenantSlug) {
    const r = await handlePhonePeCallback({ rawBody, authHeader, scope: 'platform' })
    return NextResponse.json(r.body, { status: r.status })
  }
  let ctx
  try {
    ctx = await lookupTenantContextBySlug(tenantSlug)
  } catch {
    return err('retry', 503)
  }
  if (!ctx) return err('Unknown store', 404)
  const store = ctx
  return runWithTenantContext(store, async () => {
    const r = await handlePhonePeCallback({ rawBody, authHeader, scope: { tenantId: store.tenantId } })
    return NextResponse.json(r.body, { status: r.status })
  })
}

const STATUSES = UPI_INTENT_STATUSES

/** GET /api/admin/payments/upi?status=&limit=&offset= */
export async function handleUpiAdminList(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    if (status && !STATUSES.includes(status as UpiIntentStatus)) return err('Unknown status', 400)
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50))
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0)
    const { items, total } = await listUpiIntents({ status: (status as UpiIntentStatus) || null, limit, offset })
    const orderIdOf = (i: UpiIntent) => i.refs.orderId ?? i.result?.orderId ?? null
    const orderIds = [...new Set(items.map(orderIdOf).filter(Boolean))] as string[]
    const orders = orderIds.length
      ? await queryMany<{ id: string; order_number: string; customer_name: string | null; customer_email: string | null }>(
          `SELECT id, order_number, customer_name, customer_email FROM orders WHERE id = ANY($1::uuid[])`,
          [orderIds]
        )
      : []
    const byId = new Map(orders.map(o => [o.id, o]))
    // Bank credits we saw but could not auto-confirm (untrusted sender, or no single intent to pin them on).
    const suggestions = await observationSuggestions(items.filter(i => i.provider === 'upg' && ['awaiting_confirmation', 'failed', 'expired'].includes(i.status))).catch(() => new Map())
    return NextResponse.json({
      items: items.map(i => {
        const orderId = orderIdOf(i)
        const o = orderId ? byId.get(orderId) : undefined
        return {
          id: i.id,
          status: i.status,
          purpose: i.purpose,
          provider: i.provider,
          mode: i.provider,
          receiving_vpa: i.receiving_vpa,
          observation_id: i.observation_id,
          suggestions: (suggestions.get(i.id) ?? []).map((o: any) => ({ id: o.id, utr: o.utr, amountPaise: o.amount_paise, senderVpa: o.sender_vpa, bankDomain: o.bank_domain, observedAt: iso(o.observed_at), trusted: o.trusted })),
          amount_paise: i.amount_paise,
          merchant_order_id: i.merchant_order_id,
          utr: i.utr,
          payer_vpa: i.payer_vpa,
          error_code: i.error_code,
          created_at: i.created_at,
          confirmed_at: i.confirmed_at,
          decided_at: i.decided_at,
          refs: i.refs,
          result: i.result,
          order_id: orderId,
          order_number: o?.order_number ?? i.result?.orderNumber ?? null,
          customer_name: o?.customer_name ?? null,
          customer_email: o?.customer_email ?? null,
        }
      }),
      total,
      limit,
      offset,
    })
  } catch (e: any) {
    console.error('[upi:admin-list]', e)
    return err('Failed to load UPI payments', 500)
  }
}

const DecideSchema = z.object({ action: z.enum(['approve', 'reject']) })

/** POST /api/admin/payments/upi/[intentId]/decide */
export async function handleUpiAdminDecide(request: NextRequest, intentId: string, admin: { adminId?: string | null }): Promise<NextResponse> {
  try {
    if (!z.string().uuid().safeParse(intentId).success) return err('Payment not found', 404)
    const parsed = parseBody(DecideSchema, await request.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const store = await requestStore()
    const adminId = admin.adminId && z.string().uuid().safeParse(admin.adminId).success ? admin.adminId : null
    const intent = await decideUpgUtr(intentId, parsed.data.action, adminId, { store })
    return NextResponse.json({ success: true, ...(await view(intent, storeDb)) })
  } catch (e: any) {
    if (e instanceof UpiConfirmError) return err(e.message, e.status)
    return err(e?.message || 'Could not record the decision', 500)
  }
}
