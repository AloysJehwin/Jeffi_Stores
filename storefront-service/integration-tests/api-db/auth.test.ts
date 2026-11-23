// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — storefront (public) auth route group.
// Covers the routes that read/write Postgres directly (me, sessions list/revoke/revoke-all,
// logout, abandon-signup) plus the Redis-free DB validation branches of send-otp/verify-otp.
// OTP delivery, social/oauth and session-binding (rt) routes depend on Redis/external HTTP/crypto
// and are out of this tier — see the report. Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// logout + (indirectly) any route using next/headers cookies(). cookies().set is a no-op sink.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined, set: () => {} }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

describe.skipIf(!API_DB_ENABLED)('storefront (public) auth API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let auth: typeof import('@/lib/auth/auth-sessions')
  const customerId = FIXTURES.customerId

  // throwaway rows created by this file (cleaned in afterAll)
  const extraUserIds: string[] = []

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    auth = await import('@/lib/auth/auth-sessions')
  })

  afterAll(async () => {
    await db.query('DELETE FROM auth_sessions WHERE principal_id = $1', [customerId]).catch(() => {})
    if (extraUserIds.length) {
      await db.query('DELETE FROM auth_sessions WHERE principal_id = ANY($1::uuid[])', [extraUserIds]).catch(() => {})
      await db.query('DELETE FROM failed_login_attempts WHERE user_id = ANY($1::uuid[])', [extraUserIds]).catch(() => {})
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [extraUserIds]).catch(() => {})
    }
    await endPool()
  })

  // --- GET /api/auth/me ---------------------------------------------------
  describe('me', () => {
    it('returns the real user row for an authed customer', async () => {
      const { sid } = await makeCustomerSession(auth, customerId)
      const route = await import('@storefront/app/api/(public)/auth/me/route')
      const res = await route.GET(await apiRequest('GET', 'http://localhost/api/auth/me', { sid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.user).toBeTruthy()
      expect(body.user.id).toBe(customerId)
      expect(body.user.email).toBe('apitest-customer@jeffi.test')
    })

    it('returns { user: null } for an unauthenticated request', async () => {
      const route = await import('@storefront/app/api/(public)/auth/me/route')
      const res = await route.GET(await apiRequest('GET', 'http://localhost/api/auth/me') as any)
      expect(res.status).toBe(200)
      expect((await res.json()).user).toBeNull()
    })
  })

  // --- GET /api/auth/sessions --------------------------------------------
  describe('sessions list', () => {
    it('401 for an unauthenticated request', async () => {
      const route = await import('@storefront/app/api/(public)/auth/sessions/route')
      const res = await route.GET(await apiRequest('GET', 'http://localhost/api/auth/sessions') as any)
      expect(res.status).toBe(401)
    })

    it('lists the active sessions seeded for the caller', async () => {
      const { id } = await makeCustomerSession(auth, customerId)
      const { sid } = await makeCustomerSession(auth, customerId)
      const route = await import('@storefront/app/api/(public)/auth/sessions/route')
      const res = await route.GET(await apiRequest('GET', 'http://localhost/api/auth/sessions', { sid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.sessions)).toBe(true)
      expect(body.sessions.some((s: any) => s.id === id)).toBe(true)
      expect(body.sessions.length).toBeGreaterThanOrEqual(2)
    })
  })

  // --- POST /api/auth/sessions/[id]/revoke -------------------------------
  describe('sessions revoke (by id)', () => {
    it('revokes the caller’s own target session row', async () => {
      const target = await makeCustomerSession(auth, customerId)
      const caller = await makeCustomerSession(auth, customerId)
      const route = await import('@storefront/app/api/(public)/auth/sessions/[id]/revoke/route')
      const res = await route.POST(
        await apiRequest('POST', `http://localhost/api/auth/sessions/${target.id}/revoke`, { sid: caller.sid }) as any,
        { params: Promise.resolve({ id: target.id }) }
      )
      expect(res.status).toBe(200)
      expect((await res.json()).success).toBe(true)
      const row = await db.queryOne<{ revoked_at: string | null }>(
        'SELECT revoked_at FROM auth_sessions WHERE id = $1',
        [target.id]
      )
      expect(row!.revoked_at).not.toBeNull()
    })

    it('404 when the target session id does not exist', async () => {
      const caller = await makeCustomerSession(auth, customerId)
      const missing = '00000000-0000-4000-9999-' + uniqueSuffix().padStart(12, '0')
      const route = await import('@storefront/app/api/(public)/auth/sessions/[id]/revoke/route')
      const res = await route.POST(
        await apiRequest('POST', `http://localhost/api/auth/sessions/${missing}/revoke`, { sid: caller.sid }) as any,
        { params: Promise.resolve({ id: missing }) }
      )
      expect(res.status).toBe(404)
    })

    it('403 when the target session belongs to a different principal', async () => {
      const otherId = '00000000-0000-4000-a000-' + uniqueSuffix().padStart(12, '0')
      extraUserIds.push(otherId)
      await db.query(
        "INSERT INTO users (id, email, user_type) VALUES ($1, $2, 'customer')",
        [otherId, `apitest-${uniqueSuffix()}@jeffi.test`]
      )
      const victim = await makeCustomerSession(auth, otherId)
      const caller = await makeCustomerSession(auth, customerId)
      const route = await import('@storefront/app/api/(public)/auth/sessions/[id]/revoke/route')
      const res = await route.POST(
        await apiRequest('POST', `http://localhost/api/auth/sessions/${victim.id}/revoke`, { sid: caller.sid }) as any,
        { params: Promise.resolve({ id: victim.id }) }
      )
      expect(res.status).toBe(403)
      const row = await db.queryOne<{ revoked_at: string | null }>(
        'SELECT revoked_at FROM auth_sessions WHERE id = $1',
        [victim.id]
      )
      expect(row!.revoked_at).toBeNull() // untouched
    })

    it('401 for an unauthenticated request', async () => {
      const route = await import('@storefront/app/api/(public)/auth/sessions/[id]/revoke/route')
      const res = await route.POST(
        await apiRequest('POST', 'http://localhost/api/auth/sessions/x/revoke') as any,
        { params: Promise.resolve({ id: 'x' }) }
      )
      expect(res.status).toBe(401)
    })
  })

  // --- POST /api/auth/sessions/revoke-all --------------------------------
  describe('sessions revoke-all', () => {
    it('revokes every active session for the caller and returns the count', async () => {
      // clear prior sessions so the returned count is deterministic for this user
      await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE principal_id = $1 AND revoked_at IS NULL', [customerId])
      await makeCustomerSession(auth, customerId)
      await makeCustomerSession(auth, customerId)
      const { sid } = await makeCustomerSession(auth, customerId)
      const route = await import('@storefront/app/api/(public)/auth/sessions/revoke-all/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/sessions/revoke-all', { sid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.revoked).toBeGreaterThanOrEqual(3)
      const live = await db.queryCount(
        'SELECT count(*) FROM auth_sessions WHERE principal_id = $1 AND revoked_at IS NULL',
        [customerId]
      )
      expect(live).toBe(0)
    })

    it('401 for an unauthenticated request', async () => {
      const route = await import('@storefront/app/api/(public)/auth/sessions/revoke-all/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/sessions/revoke-all') as any)
      expect(res.status).toBe(401)
    })
  })

  // --- POST /api/auth/logout ---------------------------------------------
  describe('logout', () => {
    it('revokes the caller’s session row and returns 200', async () => {
      const { sid, id } = await makeCustomerSession(auth, customerId)
      const route = await import('@storefront/app/api/(public)/auth/logout/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/logout', { sid }) as any)
      expect(res.status).toBe(200)
      const row = await db.queryOne<{ revoked_at: string | null }>(
        'SELECT revoked_at FROM auth_sessions WHERE id = $1',
        [id]
      )
      expect(row!.revoked_at).not.toBeNull()
    })

    it('still returns 200 for an unauthenticated request (idempotent logout)', async () => {
      const route = await import('@storefront/app/api/(public)/auth/logout/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/logout') as any)
      expect(res.status).toBe(200)
    })
  })

  // --- POST /api/auth/abandon-signup -------------------------------------
  describe('abandon-signup', () => {
    async function seedUser(fields: Record<string, unknown>): Promise<string> {
      const id = '00000000-0000-4000-a000-' + uniqueSuffix().padStart(12, '0')
      extraUserIds.push(id)
      const cols = ['id', 'email', 'user_type', ...Object.keys(fields)]
      const vals: unknown[] = [id, `apitest-${uniqueSuffix()}@jeffi.test`, 'customer', ...Object.values(fields)]
      const ph = cols.map((_, i) => `$${i + 1}`).join(', ')
      await db.query(`INSERT INTO users (${cols.join(', ')}) VALUES (${ph})`, vals)
      return id
    }

    it('deletes a brand-new, unverified, order-less account (real row removed)', async () => {
      const id = await seedUser({ phone_verified: false })
      const { sid } = await makeCustomerSession(auth, id)
      const route = await import('@storefront/app/api/(public)/auth/abandon-signup/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/abandon-signup', { sid }) as any)
      expect(res.status).toBe(200)
      expect((await res.json()).deleted).toBe(true)
      const row = await db.queryOne('SELECT id FROM users WHERE id = $1', [id])
      expect(row).toBeNull()
    })

    it('does not delete a phone-verified account (not_eligible)', async () => {
      const id = await seedUser({ phone_verified: true })
      const { sid } = await makeCustomerSession(auth, id)
      const route = await import('@storefront/app/api/(public)/auth/abandon-signup/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/abandon-signup', { sid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.deleted).toBe(false)
      expect(body.reason).toBe('not_eligible')
      const row = await db.queryOne('SELECT id FROM users WHERE id = $1', [id])
      expect(row).toBeTruthy() // still there
    })

    it('401 for an unauthenticated request', async () => {
      const route = await import('@storefront/app/api/(public)/auth/abandon-signup/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/abandon-signup') as any)
      expect(res.status).toBe(401)
    })
  })

  // --- POST /api/auth/send-otp (Redis-free DB branches only) -------------
  describe('send-otp validation + DB lookup branches', () => {
    it('400 when no email/identifier is supplied', async () => {
      const route = await import('@storefront/app/api/(public)/auth/send-otp/route')
      const res = await route.POST(await apiRequest('POST', 'http://localhost/api/auth/send-otp', { body: {} }) as any)
      expect(res.status).toBe(400)
    })

    it('400 for an invalid email format', async () => {
      const route = await import('@storefront/app/api/(public)/auth/send-otp/route')
      const res = await route.POST(
        await apiRequest('POST', 'http://localhost/api/auth/send-otp', { body: { email: 'not-an-email' } }) as any
      )
      expect(res.status).toBe(400)
    })

    it('404 when a login-by-phone identifier matches no verified account (real users query)', async () => {
      const route = await import('@storefront/app/api/(public)/auth/send-otp/route')
      const res = await route.POST(
        await apiRequest('POST', 'http://localhost/api/auth/send-otp', { body: { identifier: '9999900000' } }) as any
      )
      expect(res.status).toBe(404)
      expect((await res.json()).userNotFound).toBe(true)
    })
  })

  // --- POST /api/auth/verify-otp (validation branch) ---------------------
  describe('verify-otp validation', () => {
    it('400 when email or otp is missing', async () => {
      const route = await import('@storefront/app/api/(public)/auth/verify-otp/route')
      const res = await route.POST(
        await apiRequest('POST', 'http://localhost/api/auth/verify-otp', { body: { email: 'x@y.z' } }) as any
      )
      expect(res.status).toBe(400)
    })
  })
})
