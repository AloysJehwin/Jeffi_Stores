import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const queryOne = vi.fn<(...a: any[]) => any>(async () => null as any)
const queryMany = vi.fn<(...a: any[]) => any>(async () => [] as any[])
const resolveRequestTenant = vi.fn<(...a: any[]) => any>(async () => null as any)

vi.mock('@/lib/shared/db', () => ({
  queryOne: (t: string, p?: any[]) => queryOne(t, p),
  queryMany: (t: string, p?: any[]) => queryMany(t, p),
  resolveRequestTenant: () => resolveRequestTenant(),
}))
// parseBody / zNonEmpty are pure validation — use the real implementation.
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(async () => ({ gstEnabled: false })) }))
vi.mock('@/lib/orders/order-draft', () => ({ verifyDraftToken: vi.fn(), hashCartItems: vi.fn(() => 'HASH') }))
vi.mock('@/lib/orders/order-commit', () => ({ loadActiveCart: vi.fn(async () => []), cartSubtotal: vi.fn(() => 100), cartItemsForHash: vi.fn(() => []), validateCouponForUser: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/orders/adjustment-decision', () => ({ loadOpenAdjustment: vi.fn(async () => null) }))
vi.mock('@/lib/replies/context', () => ({ closeReplyContexts: vi.fn(async () => {}) }))
vi.mock('@/lib/billing/topup', () => ({ topupAmounts: vi.fn((inr: number) => ({ total: inr * 1.18 })), topupNotes: vi.fn(() => ({ note: 1 })) }))
vi.mock('@/lib/tenant-registry', () => ({ lookupTenantContextBySlug: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (t: any) => !t?.tenantId || t.tenantId === '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/payments/upi/phonepe', () => {
  class PhonePeError extends Error { constructor(m: string, readonly status: number, readonly code?: string) { super(m) } }
  return { PhonePeError }
})
vi.mock('@/lib/payments/upi/creds', () => ({ upiAvailable: vi.fn(async () => true), walletUpiAvailable: vi.fn(async () => true) }))
vi.mock('@/lib/payments/upi/intents', () => ({
  getUpiIntent: vi.fn(),
  listUpiIntents: vi.fn(async () => ({ items: [], total: 0 })),
  platformDb: { query: vi.fn(), platform: true },
  storeDb: { query: vi.fn() },
  UPI_INTENT_STATUSES: ['pending', 'queued', 'active', 'processing', 'awaiting_confirmation', 'completed', 'failed', 'expired', 'cancelled', 'rejected'],
  UPI_PURPOSES: ['order_draft', 'order', 'order_adjustment', 'variant_change', 'wallet_topup', 'ecom_wallet_topup'],
}))
vi.mock('@/lib/payments/upi/service', () => {
  class UpiUnavailableError extends Error {}
  return { startUpiPayment: vi.fn(), upgPayPayload: vi.fn(async () => ({ upiUri: 'upi://pay', qrDataUrl: 'QR' })), UpiUnavailableError }
})
vi.mock('@/lib/payments/upi/settle', () => {
  class UpiConfirmError extends Error { constructor(m: string, readonly status: number) { super(m) } }
  return { confirmUpgUtr: vi.fn(), decideUpgUtr: vi.fn(), settleUpiIntent: vi.fn(), UpiConfirmError }
})
vi.mock('@/lib/payments/upi/upg', () => ({ advanceVpa: vi.fn(async () => null), markCancelled: vi.fn(), markProcessing: vi.fn(), observationSuggestions: vi.fn(async () => new Map()), queueState: vi.fn(async () => ({ serverNow: 'NOW', queuePosition: 2 })) }))
vi.mock('@/lib/payments/upi/webhook', () => ({ handlePhonePeCallback: vi.fn(async () => ({ status: 200, body: { status: 'completed' } })) }))

import {
  handleUpiStart, handleUpiStatus, handleUpiCheck, handleUpiCancel, handleUpiConfirm, handleUpiWebhook,
  handleUpiAdminList, handleUpiAdminDecide,
} from '@/lib/payments/upi/handlers'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { verifyDraftToken } from '@/lib/orders/order-draft'
import { loadActiveCart, validateCouponForUser } from '@/lib/orders/order-commit'
import { loadOpenAdjustment } from '@/lib/orders/adjustment-decision'
import { upiAvailable, walletUpiAvailable } from '@/lib/payments/upi/creds'
import { getUpiIntent, listUpiIntents } from '@/lib/payments/upi/intents'
import { startUpiPayment, UpiUnavailableError } from '@/lib/payments/upi/service'
import { confirmUpgUtr, decideUpgUtr, settleUpiIntent, UpiConfirmError } from '@/lib/payments/upi/settle'
import { markCancelled, markProcessing } from '@/lib/payments/upi/upg'
import { handlePhonePeCallback } from '@/lib/payments/upi/webhook'
import { PhonePeError } from '@/lib/payments/upi/phonepe'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry'

const UUID = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('https://acme.test/api/payments/upi/start', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const intent = (over: Record<string, unknown> = {}) => ({ id: UUID, tenant_id: T, provider: 'phonepe', purpose: 'order', amount_paise: 5000, status: 'pending', refs: { userId: 'u1' }, result: null, return_to: '/x', receiving_vpa: null, error_code: null, pay_expires_at: null, verify_expires_at: null, created_at: 'c', confirmed_at: null, decided_at: null, merchant_order_id: 'JSx', utr: null, payer_vpa: null, ...over })
const cust = { kind: 'customer', userId: 'u1' } as const

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestTenant.mockResolvedValue({ tenantId: T, slug: 'acme' })
  vi.mocked(upiAvailable).mockResolvedValue(true)
  vi.mocked(walletUpiAvailable).mockResolvedValue(true)
  vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: false } as any)
  vi.mocked(startUpiPayment).mockResolvedValue({ intentId: UUID, mode: 'phonepe', amountPaise: 5000, redirectUrl: 'https://pp' } as any)
})

describe('handleUpiStart — validation & auth guards', () => {
  it('400 when the body fails schema', async () => {
    expect((await handleUpiStart(post({ purpose: 'nope' }), cust)).status).toBe(400)
  })
  it('customer: rejects an unsupported purpose', async () => {
    expect((await handleUpiStart(post({ purpose: 'wallet_topup' }), cust)).status).toBe(400)
  })
  it('customer: 400 when UPI is unavailable', async () => {
    vi.mocked(upiAvailable).mockResolvedValue(false)
    expect((await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)).status).toBe(400)
  })
  it('customer: each purpose needs its id', async () => {
    expect((await handleUpiStart(post({ purpose: 'order_draft' }), cust)).status).toBe(400)
    expect((await handleUpiStart(post({ purpose: 'order' }), cust)).status).toBe(400)
    expect((await handleUpiStart(post({ purpose: 'order_adjustment' }), cust)).status).toBe(400)
    expect((await handleUpiStart(post({ purpose: 'variant_change' }), cust)).status).toBe(400)
  })
})

describe('handleUpiStart — plan paths', () => {
  it('order: not found → 404, already paid → 400, cancelled → 400, else starts', async () => {
    queryOne.mockResolvedValueOnce(null)
    expect((await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)).status).toBe(404)
    queryOne.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', total_amount: '50', payment_status: 'paid', status: 'confirmed' })
    expect((await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)).status).toBe(400)
    queryOne.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', total_amount: '50', payment_status: 'pending', status: 'cancelled' })
    expect((await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)).status).toBe(400)
    queryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', user_id: 'u1', total_amount: '50', payment_status: 'pending', status: 'confirmed' })
    const r = await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)
    expect(r.status).toBe(200)
    expect(vi.mocked(startUpiPayment).mock.calls[0][0]).toMatchObject({ amountPaise: 5000, reference: 'ORD-1' })
  })
  it('order (business): matches on email/phone', async () => {
    queryOne.mockResolvedValueOnce({ email: 'a@b.com', phone: '9' }) // the users lookup
    queryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD', user_id: 'x', total_amount: '10', payment_status: 'pending', status: 'confirmed' })
    const r = await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), { kind: 'customer', userId: 'u1', isBusiness: true })
    expect(r.status).toBe(200)
  })
  it('order_draft: invalid token → 400, wrong user → 403, empty cart → 400, happy path starts', async () => {
    vi.mocked(verifyDraftToken).mockResolvedValueOnce(null)
    expect((await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)).status).toBe(400)
    vi.mocked(verifyDraftToken).mockResolvedValueOnce({ userId: 'other', mode: 'cart' } as any)
    expect((await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)).status).toBe(403)
    vi.mocked(verifyDraftToken).mockResolvedValueOnce({ userId: 'u1', mode: 'cart' } as any)
    vi.mocked(loadActiveCart).mockResolvedValueOnce([])
    expect((await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)).status).toBe(400)
    vi.mocked(verifyDraftToken).mockResolvedValueOnce({ userId: 'u1', mode: 'buyNow', buyNowItem: { price: 10, qty: 2 } } as any)
    const r = await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)
    expect(r.status).toBe(200)
    expect(vi.mocked(startUpiPayment).mock.calls[0][0].amountPaise).toBe(2000)
  })
  it('order_draft: cart hash mismatch → 409; coupon applies a discount', async () => {
    vi.mocked(verifyDraftToken).mockResolvedValueOnce({ userId: 'u1', mode: 'cart', cartHash: 'OTHER' } as any)
    vi.mocked(loadActiveCart).mockResolvedValueOnce([{ x: 1 }] as any)
    expect((await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)).status).toBe(409)
    vi.mocked(verifyDraftToken).mockResolvedValueOnce({ userId: 'u1', mode: 'cart', couponId: 'c1' } as any)
    vi.mocked(loadActiveCart).mockResolvedValueOnce([{ x: 1 }] as any)
    vi.mocked(validateCouponForUser).mockResolvedValueOnce({ ok: true, appliedDiscount: 100 } as any)
    expect((await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)).status).toBe(400) // 100-100=0 → zero total
  })
  it('order_draft: invalid draft mode → 400', async () => {
    vi.mocked(verifyDraftToken).mockResolvedValueOnce({ userId: 'u1', mode: 'weird' } as any)
    expect((await handleUpiStart(post({ purpose: 'order_draft', draftToken: 't' }), cust)).status).toBe(400)
  })
  it('order_adjustment: not found / wrong owner / wrong state / not collect', async () => {
    vi.mocked(loadOpenAdjustment).mockResolvedValueOnce(null)
    queryOne.mockResolvedValueOnce({ order_id: 'o1' })
    expect((await handleUpiStart(post({ purpose: 'order_adjustment', adjustmentId: 'a1' }), cust)).status).toBe(404)
    vi.mocked(loadOpenAdjustment).mockResolvedValueOnce({ user_id: 'other', status: 'pending_customer', order_status: 'confirmed', settlement_type: 'collect', net_diff: 5, order_id: 'o1', order_number: 'O' } as any)
    expect((await handleUpiStart(post({ purpose: 'order_adjustment', adjustmentId: 'a1', orderId: 'o1' }), cust)).status).toBe(403)
    vi.mocked(loadOpenAdjustment).mockResolvedValueOnce({ user_id: 'u1', status: 'done', order_status: 'confirmed', settlement_type: 'collect', net_diff: 5, order_id: 'o1' } as any)
    expect((await handleUpiStart(post({ purpose: 'order_adjustment', adjustmentId: 'a1', orderId: 'o1' }), cust)).status).toBe(409)
    vi.mocked(loadOpenAdjustment).mockResolvedValueOnce({ user_id: 'u1', status: 'pending_customer', order_status: 'confirmed', settlement_type: 'refund', net_diff: 5, order_id: 'o1' } as any)
    expect((await handleUpiStart(post({ purpose: 'order_adjustment', adjustmentId: 'a1', orderId: 'o1' }), cust)).status).toBe(400)
  })
  it('order_adjustment: happy collect path starts the payment', async () => {
    vi.mocked(loadOpenAdjustment).mockResolvedValueOnce({ user_id: 'u1', status: 'awaiting_payment', order_status: 'confirmed', awb_number: null, settlement_type: 'collect', net_diff: -12, order_id: 'o1', order_number: 'ORD' } as any)
    const r = await handleUpiStart(post({ purpose: 'order_adjustment', adjustmentId: 'a1', orderId: 'o1' }), cust)
    expect(r.status).toBe(200)
    expect(vi.mocked(startUpiPayment).mock.calls[0][0].amountPaise).toBe(1200)
  })
  it('variant_change: not found → 404; collect path starts', async () => {
    queryOne.mockResolvedValueOnce(null)
    expect((await handleUpiStart(post({ purpose: 'variant_change', orderId: 'o1' }), cust)).status).toBe(404)
    queryOne.mockResolvedValueOnce({ id: 'v1', order_id: 'o1', order_number: 'ORD', user_id: 'u1', order_status: 'confirmed', awb_number: null, settlement_type: 'collect', price_diff: 7 })
    const r = await handleUpiStart(post({ purpose: 'variant_change', requestId: 'v1' }), cust)
    expect(r.status).toBe(200)
    expect(vi.mocked(startUpiPayment).mock.calls[0][0].amountPaise).toBe(700)
  })
})

describe('handleUpiStart — wallet top-ups', () => {
  it('admin: unsupported purpose, unavailable, no tenant, non-positive amount, then starts', async () => {
    const admin = { kind: 'admin', adminId: ADMIN } as const
    expect((await handleUpiStart(post({ purpose: 'order' }), admin)).status).toBe(400) // wrong purpose
    vi.mocked(walletUpiAvailable).mockResolvedValueOnce(false)
    expect((await handleUpiStart(post({ purpose: 'wallet_topup', amountInr: 500 }), admin)).status).toBe(400)
    resolveRequestTenant.mockResolvedValueOnce({ tenantId: '00000000-0000-0000-0000-000000000000', slug: 'p' })
    expect((await handleUpiStart(post({ purpose: 'wallet_topup', amountInr: 500 }), admin)).status).toBe(400) // flagship
    resolveRequestTenant.mockResolvedValue({ tenantId: T, slug: 'acme' })
    expect((await handleUpiStart(post({ purpose: 'wallet_topup', amountInr: 0 }), admin)).status).toBe(400)
    const r = await handleUpiStart(post({ purpose: 'wallet_topup', amountInr: 500 }), admin)
    expect(r.status).toBe(200)
    expect(vi.mocked(startUpiPayment).mock.calls.at(-1)![0].payeeName).toBe('Jeffi Stores')
  })
  it('owner: minimum ₹100 enforced, then starts', async () => {
    const owner = { kind: 'owner', ownerId: 'own1', tenant: { id: T, slug: 'acme' } } as const
    expect((await handleUpiStart(post({ purpose: 'ecom_wallet_topup', amountInr: 50 }), owner)).status).toBe(400)
    const r = await handleUpiStart(post({ purpose: 'ecom_wallet_topup', amountInr: 100 }), owner)
    expect(r.status).toBe(200)
    expect(vi.mocked(startUpiPayment).mock.calls.at(-1)![0].refs).toMatchObject({ ownerId: 'own1' })
  })
})

describe('handleUpiStart — error mapping', () => {
  it('UpiUnavailableError → 400, PhonePeError → 502, other → 500', async () => {
    queryOne.mockResolvedValue({ id: 'o1', order_number: 'O', user_id: 'u1', total_amount: '50', payment_status: 'pending', status: 'confirmed' })
    vi.mocked(startUpiPayment).mockRejectedValueOnce(new UpiUnavailableError('no'))
    expect((await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)).status).toBe(400)
    vi.mocked(startUpiPayment).mockRejectedValueOnce(new PhonePeError('refused', 502, 'X'))
    const r = await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)
    expect(r.status).toBe(502)
    expect((await r.json()).code).toBe('X')
    vi.mocked(startUpiPayment).mockRejectedValueOnce(new Error('boom'))
    expect((await handleUpiStart(post({ purpose: 'order', orderId: 'o1' }), cust)).status).toBe(500)
  })
})

describe('handleUpiStatus', () => {
  it('404 for a non-uuid or unreadable intent', async () => {
    expect((await handleUpiStatus('not-uuid', cust)).status).toBe(404)
    vi.mocked(getUpiIntent).mockResolvedValueOnce(null)
    expect((await handleUpiStatus(UUID, cust)).status).toBe(404)
  })
  it('404 when the customer does not own the intent', async () => {
    vi.mocked(getUpiIntent).mockResolvedValueOnce(intent({ refs: { userId: 'someone-else' } }) as any)
    expect((await handleUpiStatus(UUID, cust)).status).toBe(404)
  })
  it('settles a pending phonepe intent and returns its view', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent() as any)
    vi.mocked(settleUpiIntent).mockResolvedValueOnce(intent({ status: 'completed' }) as any)
    const r = await handleUpiStatus(UUID, cust)
    expect(r.status).toBe(200)
    expect((await r.json()).status).toBe('completed')
  })
  it('runs onCompleted when completed', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ status: 'completed', provider: 'upg' }) as any)
    const onCompleted = vi.fn(async () => {})
    await handleUpiStatus(UUID, cust, { onCompleted })
    expect(onCompleted).toHaveBeenCalled()
  })
  it('UPG view carries the queue and pay payload while active', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'active', receiving_vpa: 'shop@ok' }) as any)
    const body = await (await handleUpiStatus(UUID, cust)).json()
    expect(body).toMatchObject({ mode: 'upg', queuePosition: 2, upiUri: 'upi://pay', payee: { vpa: 'shop@ok' } })
  })
  it('500 when the load throws', async () => {
    vi.mocked(getUpiIntent).mockRejectedValueOnce(new Error('db'))
    expect((await handleUpiStatus(UUID, cust)).status).toBe(500)
  })
})

describe('handleUpiCheck', () => {
  it('rejects a phonepe intent', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'phonepe', status: 'active' }) as any)
    expect((await handleUpiCheck(UUID, cust)).status).toBe(400)
  })
  it('active → processing', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'active', receiving_vpa: 'shop@ok' }) as any)
    vi.mocked(markProcessing).mockResolvedValueOnce(intent({ provider: 'upg', status: 'processing', receiving_vpa: 'shop@ok' }) as any)
    const body = await (await handleUpiCheck(UUID, cust)).json()
    expect(body.status).toBe('processing')
  })
  it('queued → 409; other states just echo', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'queued', receiving_vpa: 'shop@ok' }) as any)
    expect((await handleUpiCheck(UUID, cust)).status).toBe(409)
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'completed', receiving_vpa: 'shop@ok' }) as any)
    expect((await handleUpiCheck(UUID, cust)).status).toBe(200)
  })
})

describe('handleUpiCancel', () => {
  it('rejects phonepe; idempotent when already cancelled', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'phonepe', status: 'active' }) as any)
    expect((await handleUpiCancel(UUID, cust)).status).toBe(400)
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'cancelled', receiving_vpa: 'shop@ok' }) as any)
    expect((await handleUpiCancel(UUID, cust)).status).toBe(200)
  })
  it('409 for a non-cancellable state', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'completed', receiving_vpa: 'shop@ok' }) as any)
    expect((await handleUpiCancel(UUID, cust)).status).toBe(409)
  })
  it('cancels an active intent and advances the vpa', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'active', receiving_vpa: 'shop@ok' }) as any)
    vi.mocked(markCancelled).mockResolvedValueOnce(intent({ provider: 'upg', status: 'cancelled', receiving_vpa: 'shop@ok' }) as any)
    const body = await (await handleUpiCancel(UUID, cust)).json()
    expect(body.status).toBe('cancelled')
  })
  it('409 when the claim is lost', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'active', receiving_vpa: 'shop@ok' }) as any)
    vi.mocked(markCancelled).mockResolvedValueOnce(null)
    expect((await handleUpiCancel(UUID, cust)).status).toBe(409)
  })
})

describe('handleUpiConfirm', () => {
  const r = () => new NextRequest('https://acme.test/x', { method: 'POST', body: JSON.stringify({ utr: 'UTR1' }), headers: { 'content-type': 'application/json' } })
  it('400 when the body has no utr', async () => {
    const bad = new NextRequest('https://acme.test/x', { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } })
    expect((await handleUpiConfirm(bad, UUID, cust)).status).toBe(400)
  })
  it('404 when not found', async () => {
    vi.mocked(getUpiIntent).mockResolvedValueOnce(null)
    expect((await handleUpiConfirm(r(), UUID, cust)).status).toBe(404)
  })
  it('records the utr and returns the view', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'failed', receiving_vpa: 'shop@ok' }) as any)
    vi.mocked(confirmUpgUtr).mockResolvedValueOnce(intent({ provider: 'upg', status: 'awaiting_confirmation', receiving_vpa: 'shop@ok' }) as any)
    const body = await (await handleUpiConfirm(r(), UUID, cust)).json()
    expect(body.status).toBe('awaiting_confirmation')
  })
  it('maps UpiConfirmError to its status', async () => {
    vi.mocked(getUpiIntent).mockResolvedValue(intent({ provider: 'upg', status: 'active', receiving_vpa: 'shop@ok' }) as any)
    vi.mocked(confirmUpgUtr).mockRejectedValueOnce(new UpiConfirmError('too soon', 409))
    expect((await handleUpiConfirm(r(), UUID, cust)).status).toBe(409)
  })
})

describe('handleUpiWebhook', () => {
  const wreq = (auth: string | null) => new NextRequest('https://acme.test/api/webhooks/upi', { method: 'POST', body: 'raw', headers: auth ? { authorization: auth } : {} })
  it('400 without an authorization header', async () => {
    expect((await handleUpiWebhook(wreq(null))).status).toBe(400)
  })
  it('platform callback when no slug', async () => {
    const r = await handleUpiWebhook(wreq('Basic x'))
    expect(r.status).toBe(200)
    expect(vi.mocked(handlePhonePeCallback).mock.calls[0][0]).toMatchObject({ scope: 'platform' })
  })
  it('503 when the slug lookup throws; 404 when unknown', async () => {
    vi.mocked(lookupTenantContextBySlug).mockRejectedValueOnce(new Error('x'))
    expect((await handleUpiWebhook(wreq('Basic x'), 'acme')).status).toBe(503)
    vi.mocked(lookupTenantContextBySlug).mockResolvedValueOnce(null as any)
    expect((await handleUpiWebhook(wreq('Basic x'), 'acme')).status).toBe(404)
  })
  it('runs a store callback inside the tenant context', async () => {
    vi.mocked(lookupTenantContextBySlug).mockResolvedValueOnce({ tenantId: T, slug: 'acme' } as any)
    const r = await handleUpiWebhook(wreq('Basic x'), 'acme')
    expect(r.status).toBe(200)
    expect(vi.mocked(handlePhonePeCallback).mock.calls[0][0]).toMatchObject({ scope: { tenantId: T } })
  })
})

describe('handleUpiAdminList', () => {
  const lreq = (qs = '') => new NextRequest(`https://acme.test/api/admin/payments/upi${qs}`)
  it('400 for an unknown status', async () => {
    expect((await handleUpiAdminList(lreq('?status=bogus'))).status).toBe(400)
  })
  it('lists items, joins orders and clamps paging', async () => {
    vi.mocked(listUpiIntents).mockResolvedValueOnce({ items: [intent({ refs: { orderId: 'o1' } })], total: 1 } as any)
    queryMany.mockResolvedValueOnce([{ id: 'o1', order_number: 'ORD', customer_name: 'N', customer_email: 'e' }])
    const body = await (await handleUpiAdminList(lreq('?limit=9999&offset=-1'))).json()
    expect(body.limit).toBe(200)
    expect(body.offset).toBe(0)
    expect(body.items[0]).toMatchObject({ order_number: 'ORD', customer_name: 'N' })
  })
  it('500 when listing throws', async () => {
    vi.mocked(listUpiIntents).mockRejectedValueOnce(new Error('x'))
    expect((await handleUpiAdminList(lreq())).status).toBe(500)
  })
})

describe('handleUpiAdminDecide', () => {
  const dreq = (body: unknown) => new NextRequest('https://acme.test/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  it('404 for a non-uuid intent id', async () => {
    expect((await handleUpiAdminDecide(dreq({ action: 'approve' }), 'nope', { adminId: ADMIN })).status).toBe(404)
  })
  it('400 for a bad action', async () => {
    expect((await handleUpiAdminDecide(dreq({ action: 'maybe' }), UUID, { adminId: ADMIN })).status).toBe(400)
  })
  it('decides and returns success + view; non-uuid adminId becomes null', async () => {
    vi.mocked(decideUpgUtr).mockResolvedValueOnce(intent({ status: 'completed' }) as any)
    const body = await (await handleUpiAdminDecide(dreq({ action: 'approve' }), UUID, { adminId: 'not-a-uuid' })).json()
    expect(body).toMatchObject({ success: true, status: 'completed' })
    expect(vi.mocked(decideUpgUtr).mock.calls[0][2]).toBeNull()
  })
  it('maps UpiConfirmError and other errors', async () => {
    vi.mocked(decideUpgUtr).mockRejectedValueOnce(new UpiConfirmError('nope', 409))
    expect((await handleUpiAdminDecide(dreq({ action: 'reject' }), UUID, { adminId: ADMIN })).status).toBe(409)
    vi.mocked(decideUpgUtr).mockRejectedValueOnce(new Error('boom'))
    expect((await handleUpiAdminDecide(dreq({ action: 'reject' }), UUID, { adminId: ADMIN })).status).toBe(500)
  })
})
