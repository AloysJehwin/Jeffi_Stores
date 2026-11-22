// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — storefront vault (public) routes.
// Covers GET /api/vault/owned (entitlement read against vault_entitlements) and
// POST /api/vault/logout (revokeSession side-effect on auth_sessions + cookie clear).
// Real customer session (resolveSession), real SQL side-effects asserted against jeffi_test.
// Opt-in via API_DB=1.
//
// Skipped (not DB-testable without a source change — see report):
//   /api/vault/stream  — requireVaultSession() reads next/headers cookies() + ambient tenant,
//                        null when the handler is called directly with a NextRequest.
//   /api/vault/handoff — redirect-only SSO ticket mint; no Postgres side-effect to assert.
//   /api/vault/pdf-worker, /api/vault/local/[...path] — filesystem/local-storage, no Postgres.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// Session cookie value → the token_hash stored on auth_sessions (sha256 hex). pgcrypto's digest()
// is not installed in jeffi_test, so hash in JS rather than in SQL.
const hashSid = (sid: string) => crypto.createHash('sha256').update(sid).digest('hex')

describe.skipIf(!API_DB_ENABLED)('vault/owned API (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const ownedProduct = FIXTURES.product1 // seeded entitlement below
  const unownedProduct = FIXTURES.product2 // no entitlement
  // Per-file seeded rows (order → order_item → entitlement; FK chain required by vault_entitlements).
  const sfx = uniqueSuffix()
  const orderId = `00000000-0000-4000-dddd-${sfx.padEnd(12, '0')}`
  const orderItemId = `00000000-0000-4000-eeee-${sfx.padEnd(12, '0')}`
  const entId = `00000000-0000-4000-ffff-${sfx.padEnd(12, '0')}`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@storefront/app/api/(public)/vault/owned/route')
    GET = route.GET as any
    ;({ sid } = await makeCustomerSession(auth, userId))
    await db.query('DELETE FROM vault_entitlements WHERE id = $1', [entId])
    await db.query(
      `INSERT INTO orders (id, order_number, subtotal, total_amount, user_id)
       VALUES ($1, $2, 10, 10, $3)`,
      [orderId, `VAULT-${sfx}`, userId]
    )
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price, is_digital)
       VALUES ($1, $2, $3, 'Owned digital', 1, 10, 10, true)`,
      [orderItemId, orderId, ownedProduct]
    )
    await db.query(
      `INSERT INTO vault_entitlements (id, user_id, product_id, order_id, order_item_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [entId, userId, ownedProduct, orderId, orderItemId]
    )
  })

  afterAll(async () => {
    // orders delete cascades order_items + vault_entitlements.
    await db.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='customer'`, [userId]).catch(() => {})
    // endPool() is called once at the end of the logout block (shared global pool).
  })

  it('GET reports owned=true with a url for a product the buyer holds', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/vault/owned?productId=${ownedProduct}`, { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.owned).toBe(true)
    expect(body.url).toBeTruthy()
    // Prove it read the real row (active entitlement exists for this user+product).
    const n = await db.queryCount(
      `SELECT count(*) FROM vault_entitlements WHERE user_id = $1 AND product_id = $2 AND status='active'`,
      [userId, ownedProduct]
    )
    expect(n).toBe(1)
  })

  it('GET reports owned=false for a product with no entitlement', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/vault/owned?productId=${unownedProduct}`, { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.owned).toBe(false)
    expect(body.url).toBeNull()
  })

  it('GET owned=false once the entitlement is revoked (status gate is real)', async () => {
    await db.query(`UPDATE vault_entitlements SET status='revoked' WHERE id = $1`, [entId])
    const res = await GET(await apiRequest('GET', `http://localhost/api/vault/owned?productId=${ownedProduct}`, { sid }) as any)
    const body = await res.json()
    expect(body.owned).toBe(false)
    await db.query(`UPDATE vault_entitlements SET status='active' WHERE id = $1`, [entId]) // restore
  })

  it('GET with a non-UUID productId returns 400', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/vault/owned?productId=not-a-uuid', { sid }) as any)
    expect(res.status).toBe(400)
  })

  it('GET with no productId returns 400', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/vault/owned', { sid }) as any)
    expect(res.status).toBe(400)
  })

  it('GET as a guest (no session) returns 200 owned=false, never the url', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/vault/owned?productId=${ownedProduct}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.owned).toBe(false)
    expect(body.url).toBeNull()
  })
})

describe.skipIf(!API_DB_ENABLED)('vault/logout API (real DB)', () => {
  let POST: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let auth: typeof import('@/lib/auth/auth-sessions')
  const userId = FIXTURES.customerId

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@storefront/app/api/(public)/vault/logout/route')
    POST = route.POST as any
  })

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='customer'`, [userId]).catch(() => {})
    await endPool()
  })

  it('POST with a vault_sid cookie revokes that session row and clears the cookie', async () => {
    // revokeSession matches on token_hash regardless of principal; a customer session proves the write.
    const { sid } = await makeCustomerSession(auth, userId)
    const before = await db.queryOne<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM auth_sessions WHERE token_hash = $1`,
      [hashSid(sid)]
    )
    expect(before).toBeTruthy()
    expect(before!.revoked_at).toBeNull()

    const res = await POST(await apiRequest('POST', 'http://localhost/api/vault/logout', {
      headers: { Cookie: `vault_sid=${sid}` },
    }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Cookie cleared (maxAge 0 → expired Set-Cookie).
    expect(res.headers.get('set-cookie') || '').toMatch(/vault_sid=/)

    // Real side-effect: the session row is now revoked.
    const after = await db.queryOne<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM auth_sessions WHERE token_hash = $1`,
      [hashSid(sid)]
    )
    expect(after!.revoked_at).not.toBeNull()
  })

  it('POST with no vault_sid cookie still returns 200 ok (nothing to revoke)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/vault/logout') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
