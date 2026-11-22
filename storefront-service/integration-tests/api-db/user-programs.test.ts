// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront /api/(public)/user remaining DB-backed routes:
// dashboard, loyalty (+redeem), referrals, review-coupons, subscriptions (+[id]),
// notification-preferences, push-devices (+[token]). Real session + real reads/writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('user programs/misc API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let dashGET: (req: any) => Promise<Response>
  let loyGET: (req: any) => Promise<Response>
  let redeemPOST: (req: any) => Promise<Response>
  let refGET: (req: any) => Promise<Response>
  let rcGET: (req: any) => Promise<Response>
  let subGET: (req: any) => Promise<Response>
  let subPOST: (req: any, ctx: any) => Promise<Response>
  let prefGET: (req: any) => Promise<Response>
  let prefPUT: (req: any) => Promise<Response>
  let devPOST: (req: any) => Promise<Response>
  let devDELETE: (req: any, ctx: any) => Promise<Response>
  let sid = ''
  const userId = FIXTURES.customerId
  const devToken = `apitest-device-${uniqueSuffix()}${uniqueSuffix()}` // >=20 chars

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    dashGET = (await import('@storefront/app/api/(public)/user/dashboard/route')).GET as any
    loyGET = (await import('@storefront/app/api/(public)/user/loyalty/route')).GET as any
    redeemPOST = (await import('@storefront/app/api/(public)/user/loyalty/redeem/route')).POST as any
    refGET = (await import('@storefront/app/api/(public)/user/referrals/route')).GET as any
    rcGET = (await import('@storefront/app/api/(public)/user/review-coupons/route')).GET as any
    const sub = await import('@storefront/app/api/(public)/user/subscriptions/route')
    subGET = sub.GET as any
    subPOST = (await import('@storefront/app/api/(public)/user/subscriptions/[id]/route')).POST as any
    const pref = await import('@storefront/app/api/(public)/user/notification-preferences/route')
    prefGET = pref.GET as any
    prefPUT = pref.PUT as any
    devPOST = (await import('@storefront/app/api/(public)/user/push-devices/route')).POST as any
    devDELETE = (await import('@storefront/app/api/(public)/user/push-devices/[token]/route')).DELETE as any
    ;({ sid } = await makeCustomerSession(auth, userId))
    await db.query('DELETE FROM push_devices WHERE token = $1', [devToken])
  })

  afterAll(async () => {
    await db.query('DELETE FROM push_devices WHERE token = $1', [devToken]).catch(() => {})
    await endPool()
  })

  // --- dashboard ---
  it('dashboard 401 without a session', async () => {
    const res = await dashGET(await apiRequest('GET', 'http://localhost/api/user/dashboard') as any)
    expect(res.status).toBe(401)
  })

  it('dashboard returns real aggregate stats for the fixture customer', async () => {
    const res = await dashGET(await apiRequest('GET', 'http://localhost/api/user/dashboard', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('stats')
    expect(body.stats).toHaveProperty('total_orders')
    expect(typeof body.stats.total_orders).toBe('number')
    expect(Array.isArray(body.recentOrders)).toBe(true)
    expect(typeof body.wishlistCount).toBe('number')
  })

  // --- loyalty (disabled with no site_settings → deterministic) ---
  it('loyalty 401 without a session', async () => {
    const res = await loyGET(await apiRequest('GET', 'http://localhost/api/user/loyalty') as any)
    expect(res.status).toBe(401)
  })

  it('loyalty GET reports disabled when the program is off', async () => {
    const res = await loyGET(await apiRequest('GET', 'http://localhost/api/user/loyalty', { sid }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).enabled).toBe(false)
  })

  it('loyalty redeem 404 when the program is disabled', async () => {
    const res = await redeemPOST(
      await apiRequest('POST', 'http://localhost/api/user/loyalty/redeem', { sid, body: { points: 100 } }) as any
    )
    expect(res.status).toBe(404)
  })

  it('loyalty redeem 400 for an invalid points payload', async () => {
    const res = await redeemPOST(
      await apiRequest('POST', 'http://localhost/api/user/loyalty/redeem', { sid, body: { points: 0 } }) as any
    )
    expect(res.status).toBe(400)
  })

  // --- referrals ---
  it('referrals 401 without a session', async () => {
    const res = await refGET(await apiRequest('GET', 'http://localhost/api/user/referrals') as any)
    expect(res.status).toBe(401)
  })

  it('referrals GET reports disabled when the program is off', async () => {
    const res = await refGET(await apiRequest('GET', 'http://localhost/api/user/referrals', { sid }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).enabled).toBe(false)
  })

  // --- review-coupons (guest → null, authed with none → null) ---
  it('review-coupons returns null coupon for a guest (no session)', async () => {
    const res = await rcGET(await apiRequest('GET', 'http://localhost/api/user/review-coupons') as any)
    expect(res.status).toBe(200)
    expect((await res.json()).coupon).toBeNull()
  })

  it('review-coupons returns null when the customer has none', async () => {
    const res = await rcGET(await apiRequest('GET', 'http://localhost/api/user/review-coupons', { sid }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).coupon).toBeNull()
  })

  // --- subscriptions ---
  it('subscriptions 401 without a session', async () => {
    const res = await subGET(await apiRequest('GET', 'http://localhost/api/user/subscriptions') as any)
    expect(res.status).toBe(401)
  })

  it('subscriptions GET returns a list for the customer', async () => {
    const res = await subGET(await apiRequest('GET', 'http://localhost/api/user/subscriptions', { sid }) as any)
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).subscriptions)).toBe(true)
  })

  it('subscriptions/[id] 404 for a non-uuid id', async () => {
    const res = await subPOST(
      await apiRequest('POST', 'http://localhost/api/user/subscriptions/not-a-uuid', { sid, body: { action: 'cancel' } }) as any,
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    )
    expect(res.status).toBe(404)
  })

  it('subscriptions/[id] 404 for a subscription the customer does not own', async () => {
    const other = '00000000-0000-4000-f000-000000000001'
    const res = await subPOST(
      await apiRequest('POST', `http://localhost/api/user/subscriptions/${other}`, { sid, body: { action: 'pause' } }) as any,
      { params: Promise.resolve({ id: other }) }
    )
    expect(res.status).toBe(404)
  })

  // --- notification-preferences ---
  it('notification-preferences 401 without a session', async () => {
    const res = await prefGET(await apiRequest('GET', 'http://localhost/api/user/notification-preferences') as any)
    expect(res.status).toBe(401)
  })

  it('notification-preferences GET returns the category defaults', async () => {
    const res = await prefGET(await apiRequest('GET', 'http://localhost/api/user/notification-preferences', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.categories)).toBe(true)
    expect(body.categories.length).toBeGreaterThan(0)
    expect(body).toHaveProperty('marketing_opt_out')
  })

  it('notification-preferences PUT 400 for an empty categories array', async () => {
    const res = await prefPUT(
      await apiRequest('PUT', 'http://localhost/api/user/notification-preferences', { sid, body: { categories: [] } }) as any
    )
    expect(res.status).toBe(400)
  })

  // --- push-devices (works signed-in; writes push_devices) ---
  it('push-devices POST 400 for a too-short token', async () => {
    const res = await devPOST(
      await apiRequest('POST', 'http://localhost/api/user/push-devices', { sid, body: { token: 'short', platform: 'android' } }) as any
    )
    expect(res.status).toBe(400)
  })

  it('push-devices POST upserts a real device row attached to the signed-in user', async () => {
    const res = await devPOST(
      await apiRequest('POST', 'http://localhost/api/user/push-devices', {
        sid,
        body: { token: devToken, platform: 'android', offers_opt_in: true },
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.signed_in).toBe(true)
    const row = await db.queryOne<{ user_id: string; platform: string; offers_opt_in: boolean }>(
      'SELECT user_id, platform, offers_opt_in FROM push_devices WHERE token = $1',
      [devToken]
    )
    expect(row!.user_id).toBe(userId)
    expect(row!.platform).toBe('android')
    expect(row!.offers_opt_in).toBe(true)
  })

  it('push-devices/[token] DELETE detaches the user from the install (no auth needed)', async () => {
    const res = await devDELETE(
      await apiRequest('DELETE', `http://localhost/api/user/push-devices/${encodeURIComponent(devToken)}`) as any,
      { params: Promise.resolve({ token: encodeURIComponent(devToken) }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ user_id: string | null }>('SELECT user_id FROM push_devices WHERE token = $1', [devToken])
    expect(row).toBeTruthy() // install stays registered
    expect(row!.user_id).toBeNull() // but detached from the user
  })
})
