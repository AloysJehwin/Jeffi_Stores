// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront /api/(public)/user profile + search-history.
// Real customer session (Bearer sid → resolveSession), real handlers, real SQL side-effects.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('user profile API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let updatePATCH: (req: any) => Promise<Response>
  let acceptPOST: (req: any) => Promise<Response>
  let shGET: (req: any) => Promise<Response>
  let shPOST: (req: any) => Promise<Response>
  let shDELETE: (req: any) => Promise<Response>
  let POLICY_VERSION: string
  let sid = ''
  const userId = FIXTURES.customerId

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    updatePATCH = (await import('@storefront/app/api/(public)/user/update/route')).PATCH as any
    acceptPOST = (await import('@storefront/app/api/(public)/user/accept-policies/route')).POST as any
    const sh = await import('@storefront/app/api/(public)/user/search-history/route')
    shGET = sh.GET as any
    shPOST = sh.POST as any
    shDELETE = sh.DELETE as any
    POLICY_VERSION = (await import('@/lib/legals/policies')).POLICY_VERSION
    ;({ sid } = await makeCustomerSession(auth, userId))
    await db.query('DELETE FROM user_search_history WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await db.query('DELETE FROM user_search_history WHERE user_id = $1', [userId]).catch(() => {})
    // Reset mutated profile columns on the shared fixture.
    await db
      .query(
        `UPDATE users SET first_name='API', last_name='Customer', phone=NULL, notification_channel='email',
                          date_of_birth=NULL, policies_accepted_version=NULL, policies_accepted_at=NULL
         WHERE id=$1`,
        [userId]
      )
      .catch(() => {})
    await endPool()
  })

  // --- update (PATCH) ---
  it('PATCH 401 without a session', async () => {
    const res = await updatePATCH(await apiRequest('PATCH', 'http://localhost/api/user/update', { body: { firstName: 'X' } }) as any)
    expect(res.status).toBe(401)
  })

  it('PATCH updates name + phone + channel and persists the real row', async () => {
    const res = await updatePATCH(
      await apiRequest('PATCH', 'http://localhost/api/user/update', {
        sid,
        body: { firstName: 'Updated', lastName: 'Name', phone: '9876543210', notificationChannel: 'sms' },
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.firstName).toBe('Updated')
    expect(body.user.phone).toBe('9876543210') // normalized to 10 digits
    expect(body.user.notificationChannel).toBe('sms')
    const row = await db.queryOne<{ first_name: string; phone: string; notification_channel: string }>(
      'SELECT first_name, phone, notification_channel FROM users WHERE id = $1',
      [userId]
    )
    expect(row!.first_name).toBe('Updated')
    expect(row!.phone).toBe('9876543210')
    expect(row!.notification_channel).toBe('sms')
  })

  it('PATCH with no fields returns 400 (schema refine)', async () => {
    const res = await updatePATCH(await apiRequest('PATCH', 'http://localhost/api/user/update', { sid, body: {} }) as any)
    expect(res.status).toBe(400)
  })

  it('PATCH with an invalid phone returns 400', async () => {
    const res = await updatePATCH(
      await apiRequest('PATCH', 'http://localhost/api/user/update', { sid, body: { phone: '12345' } }) as any
    )
    expect(res.status).toBe(400)
  })

  // --- accept-policies (POST) ---
  it('accept-policies 401 without a session', async () => {
    const res = await acceptPOST(await apiRequest('POST', 'http://localhost/api/user/accept-policies', { body: {} }) as any)
    expect(res.status).toBe(401)
  })

  it('accept-policies 400 for a stale version', async () => {
    const res = await acceptPOST(
      await apiRequest('POST', 'http://localhost/api/user/accept-policies', { sid, body: { version: 'ancient-0' } }) as any
    )
    expect(res.status).toBe(400)
  })

  it('accept-policies records the current version on the real row', async () => {
    const res = await acceptPOST(
      await apiRequest('POST', 'http://localhost/api/user/accept-policies', { sid, body: { version: POLICY_VERSION } }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe(POLICY_VERSION)
    const row = await db.queryOne<{ policies_accepted_version: string; policies_accepted_at: string | null }>(
      'SELECT policies_accepted_version, policies_accepted_at FROM users WHERE id = $1',
      [userId]
    )
    expect(row!.policies_accepted_version).toBe(POLICY_VERSION)
    expect(row!.policies_accepted_at).not.toBeNull()
  })

  // --- search-history (GET/POST/DELETE) ---
  it('search-history GET returns empty history for a session with none', async () => {
    const res = await shGET(await apiRequest('GET', 'http://localhost/api/user/search-history', { sid }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).history).toEqual([])
  })

  it('search-history POST inserts a real row; GET returns it newest-first', async () => {
    const p1 = await shPOST(await apiRequest('POST', 'http://localhost/api/user/search-history', { sid, body: { query: 'shoes' } }) as any)
    expect(p1.status).toBe(200)
    await shPOST(await apiRequest('POST', 'http://localhost/api/user/search-history', { sid, body: { query: 'socks' } }) as any)
    const n = await db.queryCount('SELECT count(*) FROM user_search_history WHERE user_id = $1', [userId])
    expect(n).toBe(2)
    const res = await shGET(await apiRequest('GET', 'http://localhost/api/user/search-history', { sid }) as any)
    expect((await res.json()).history).toEqual(['socks', 'shoes'])
  })

  it('search-history POST de-dupes a repeat term (case-insensitive)', async () => {
    await shPOST(await apiRequest('POST', 'http://localhost/api/user/search-history', { sid, body: { query: 'SHOES' } }) as any)
    const n = await db.queryCount(
      "SELECT count(*) FROM user_search_history WHERE user_id = $1 AND lower(query) = 'shoes'",
      [userId]
    )
    expect(n).toBe(1)
  })

  it('search-history POST 400 for an empty term', async () => {
    const res = await shPOST(await apiRequest('POST', 'http://localhost/api/user/search-history', { sid, body: { query: '   ' } }) as any)
    expect(res.status).toBe(400)
  })

  it('search-history POST 401 without a session', async () => {
    const res = await shPOST(await apiRequest('POST', 'http://localhost/api/user/search-history', { body: { query: 'x' } }) as any)
    expect(res.status).toBe(401)
  })

  it('search-history DELETE clears all rows for the user', async () => {
    const res = await shDELETE(await apiRequest('DELETE', 'http://localhost/api/user/search-history', { sid }) as any)
    expect(res.status).toBe(200)
    const n = await db.queryCount('SELECT count(*) FROM user_search_history WHERE user_id = $1', [userId])
    expect(n).toBe(0)
  })
})
