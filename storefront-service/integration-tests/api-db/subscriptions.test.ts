// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront subscriptions route group.
// Covers the DB-driven + validation + auth paths of quote / create / verify / autopay[id].
// Successful 200 flows hit Razorpay/PhonePe (external) and are intentionally not exercised here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('subscriptions API (real DB)', () => {
  let quotePOST: (req: any) => Promise<Response>
  let createPOST: (req: any) => Promise<Response>
  let verifyPOST: (req: any) => Promise<Response>
  let autopayGET: (req: any, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const notSubProduct = FIXTURES.product1 // seed product: is_subscription = false
  const randomProduct = crypto.randomUUID()
  const addressId = crypto.randomUUID()

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    quotePOST = (await import('@storefront/app/api/(public)/subscriptions/quote/route')).POST as any
    createPOST = (await import('@storefront/app/api/(public)/subscriptions/route')).POST as any
    verifyPOST = (await import('@storefront/app/api/(public)/subscriptions/verify/route')).POST as any
    autopayGET = (await import('@storefront/app/api/(public)/subscriptions/autopay/[id]/route')).GET as any
    ;({ sid } = await makeCustomerSession(auth, userId))
  })

  afterAll(async () => {
    await endPool()
  })

  // ---- quote (POST) : deriveSubscriptionOffer reads products from Postgres ----

  it('quote 401 when unauthenticated', async () => {
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/subscriptions/quote', {
      body: { productId: notSubProduct, interval: 'monthly' },
    }) as any)
    expect(res.status).toBe(401)
  })

  it('quote 400 on missing productId (validation)', async () => {
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/subscriptions/quote', {
      sid, body: { interval: 'monthly' },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('quote 400 on non-uuid productId (validation)', async () => {
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/subscriptions/quote', {
      sid, body: { productId: 'not-a-uuid', interval: 'monthly' },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('quote: real product that is not a subscription product -> 400 (DB-driven SubscriptionError)', async () => {
    // Confirm the seed row is a real, active, non-subscription product (the branch under test).
    const p = await db.queryOne<{ is_subscription: boolean; is_active: boolean }>(
      'SELECT is_subscription, is_active FROM products WHERE id = $1', [notSubProduct]
    )
    expect(p).toBeTruthy()
    expect(p!.is_active).toBe(true)
    expect(p!.is_subscription).toBe(false)
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/subscriptions/quote', {
      sid, body: { productId: notSubProduct, interval: 'monthly' },
    }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toMatch(/subscription/i)
  })

  it('quote: unknown product id -> 404 (SubscriptionError status propagated)', async () => {
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/subscriptions/quote', {
      sid, body: { productId: randomProduct, interval: 'monthly' },
    }) as any)
    expect(res.status).toBe(404)
  })

  // ---- create (POST) : auth + validation (downstream Razorpay/PhonePe not exercised) ----

  it('create 401 when unauthenticated', async () => {
    const res = await createPOST(await apiRequest('POST', 'http://localhost/api/subscriptions', {
      body: { productId: notSubProduct, interval: 'monthly', addressId, consent: true },
    }) as any)
    expect(res.status).toBe(401)
  })

  it('create 400 when consent not accepted (validation)', async () => {
    const res = await createPOST(await apiRequest('POST', 'http://localhost/api/subscriptions', {
      sid, body: { productId: notSubProduct, interval: 'monthly', addressId },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('create 400 on missing addressId (validation)', async () => {
    const res = await createPOST(await apiRequest('POST', 'http://localhost/api/subscriptions', {
      sid, body: { productId: notSubProduct, interval: 'monthly', consent: true },
    }) as any)
    expect(res.status).toBe(400)
  })

  // ---- verify (POST) : auth + validation (signature/Razorpay downstream not exercised) ----

  it('verify 401 when unauthenticated', async () => {
    const res = await verifyPOST(await apiRequest('POST', 'http://localhost/api/subscriptions/verify', {
      body: { razorpay_payment_id: 'p', razorpay_subscription_id: 's', razorpay_signature: 'x' },
    }) as any)
    expect(res.status).toBe(401)
  })

  it('verify 400 on missing fields (validation)', async () => {
    const res = await verifyPOST(await apiRequest('POST', 'http://localhost/api/subscriptions/verify', {
      sid, body: { razorpay_payment_id: 'p' },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('verify: unknown subscription -> 404 (DB-driven, no such row for user)', async () => {
    const res = await verifyPOST(await apiRequest('POST', 'http://localhost/api/subscriptions/verify', {
      sid, body: {
        razorpay_payment_id: `pay_${uniqueSuffix()}`,
        razorpay_subscription_id: `sub_${uniqueSuffix()}`,
        razorpay_signature: 'deadbeef',
      },
    }) as any)
    // No subscriptions row matches -> SubscriptionError('Subscription not found', 404) before any Razorpay call.
    expect(res.status).toBe(404)
  })

  // ---- autopay/[id] (GET) : auth + param validation (PhonePe downstream not exercised) ----

  it('autopay 401 when unauthenticated', async () => {
    const id = crypto.randomUUID()
    const res = await autopayGET(
      await apiRequest('GET', `http://localhost/api/subscriptions/autopay/${id}`, {}) as any,
      { params: Promise.resolve({ id }) }
    )
    expect(res.status).toBe(401)
  })

  it('autopay 404 on non-uuid id (param validation)', async () => {
    const res = await autopayGET(
      await apiRequest('GET', 'http://localhost/api/subscriptions/autopay/not-a-uuid', { sid }) as any,
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    )
    expect(res.status).toBe(404)
  })
})
