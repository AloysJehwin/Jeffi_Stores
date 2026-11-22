// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront wishlist. Exemplar proving the harness:
// real customer session (resolveSession), real POST/DELETE handlers, real SQL side-effects asserted
// against jeffi_test. Opt-in via API_DB=1. Run: npm run test:db
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, cleanupRows, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('wishlist API (real DB)', () => {
  let POST: (req: any) => Promise<Response>
  let GET: (req: any) => Promise<Response>
  let DELETE: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const productId = FIXTURES.product1

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@storefront/app/api/(public)/wishlist/route')
    POST = route.POST as any
    GET = route.GET as any
    DELETE = route.DELETE as any
    ;({ sid } = await makeCustomerSession(auth, userId))
    // Clean any stale wishlist row for this fixture user+product
    await db.query('DELETE FROM wishlist_items WHERE user_id = $1 AND product_id = $2', [userId, productId])
  })

  afterAll(async () => {
    await db.query('DELETE FROM wishlist_items WHERE user_id = $1', [userId]).catch(() => {})
    await endPool()
  })

  it('POST adds a real wishlist row for the authed customer', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/wishlist', { sid, body: { productId }}) as any)
    expect(res.status).toBe(200)
    // Real side-effect: the row exists in jeffi_test with this user+product.
    const row = await db.queryOne<{ user_id: string; product_id: string }>(
      'SELECT user_id, product_id FROM wishlist_items WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    )
    expect(row).toBeTruthy()
    expect(row!.product_id).toBe(productId)
  })

  it('POST is idempotent (no duplicate row on second add)', async () => {
    await POST(await apiRequest('POST', 'http://localhost/api/wishlist', { sid, body: { productId }}) as any)
    const n = await db.queryCount(
      'SELECT count(*) FROM wishlist_items WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    )
    expect(n).toBe(1)
  })

  it('GET returns the saved product id for ?ids=1', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/wishlist?ids=1', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.productIds).toContain(productId)
  })

  it('POST with missing productId returns 400 (real validation)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/wishlist', { sid, body: {} }) as any)
    expect(res.status).toBe(400)
  })

  it('DELETE removes the real row', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/wishlist?productId=${productId}`, { sid }) as any)
    expect(res.status).toBe(200)
    const row = await db.queryOne('SELECT id FROM wishlist_items WHERE user_id = $1 AND product_id = $2', [userId, productId])
    expect(row).toBeNull()
  })
})
