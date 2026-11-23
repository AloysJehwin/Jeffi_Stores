// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront /api/(public)/user/addresses (+ [id]).
// Real customer session, real CRUD, real SQL side-effects and ownership/default guards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('user addresses API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let GET: (req: any) => Promise<Response>
  let POST: (req: any) => Promise<Response>
  let PATCH: (req: any, ctx: any) => Promise<Response>
  let DELETE: (req: any, ctx: any) => Promise<Response>
  let sid = ''
  const userId = FIXTURES.customerId

  const validBody = {
    full_name: 'Jane Buyer',
    phone: '9000000001',
    address_line1: '12 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    postal_code: '560001',
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const list = await import('@storefront/app/api/(public)/user/addresses/route')
    GET = list.GET as any
    POST = list.POST as any
    const item = await import('@storefront/app/api/(public)/user/addresses/[id]/route')
    PATCH = item.PATCH as any
    DELETE = item.DELETE as any
    ;({ sid } = await makeCustomerSession(auth, userId))
    await db.query('DELETE FROM addresses WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await db.query('DELETE FROM addresses WHERE user_id = $1', [userId]).catch(() => {})
    await endPool()
  })

  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/user/addresses') as any)
    expect(res.status).toBe(401)
  })

  it('GET returns an empty list before any address', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/user/addresses', { sid }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).addresses).toEqual([])
  })

  let createdId = ''
  it('POST inserts a real address (phone normalized to +91##########)', async () => {
    const res = await POST(
      await apiRequest('POST', 'http://localhost/api/user/addresses', { sid, body: { ...validBody, is_default: true } }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    createdId = body.address.id
    expect(body.address.phone).toBe('+919000000001')
    const row = await db.queryOne<{ city: string; is_default: boolean; phone: string }>(
      'SELECT city, is_default, phone FROM addresses WHERE id = $1 AND user_id = $2',
      [createdId, userId]
    )
    expect(row).toBeTruthy()
    expect(row!.city).toBe('Bengaluru')
    expect(row!.is_default).toBe(true)
  })

  it('POST 400 for a missing required field (full_name)', async () => {
    const { full_name: _omit, ...noName } = validBody
    const res = await POST(await apiRequest('POST', 'http://localhost/api/user/addresses', { sid, body: noName }) as any)
    expect(res.status).toBe(400)
  })

  it('POST 400 for an invalid PIN code', async () => {
    const res = await POST(
      await apiRequest('POST', 'http://localhost/api/user/addresses', { sid, body: { ...validBody, postal_code: '12' } }) as any
    )
    expect(res.status).toBe(400)
  })

  it('PATCH updates the owned address and persists the change', async () => {
    const res = await PATCH(
      await apiRequest('PATCH', `http://localhost/api/user/addresses/${createdId}`, {
        sid,
        body: { ...validBody, city: 'Mysuru', is_default: false },
      }) as any,
      { params: Promise.resolve({ id: createdId }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ city: string }>('SELECT city FROM addresses WHERE id = $1', [createdId])
    expect(row!.city).toBe('Mysuru')
  })

  it('PATCH 404 for an address the user does not own', async () => {
    const res = await PATCH(
      await apiRequest('PATCH', 'http://localhost/api/user/addresses/00000000-0000-4000-dddd-000000000099', {
        sid,
        body: validBody,
      }) as any,
      { params: Promise.resolve({ id: '00000000-0000-4000-dddd-000000000099' }) }
    )
    expect(res.status).toBe(404)
  })

  it('DELETE 400 while the address is the default', async () => {
    // Make it default again, then try to delete.
    await db.query('UPDATE addresses SET is_default = true WHERE id = $1', [createdId])
    const res = await DELETE(
      await apiRequest('DELETE', `http://localhost/api/user/addresses/${createdId}`, { sid }) as any,
      { params: Promise.resolve({ id: createdId }) }
    )
    expect(res.status).toBe(400)
    expect(await db.queryCount('SELECT count(*) FROM addresses WHERE id = $1', [createdId])).toBe(1)
  })

  it('DELETE removes a non-default address for real', async () => {
    await db.query('UPDATE addresses SET is_default = false WHERE id = $1', [createdId])
    const res = await DELETE(
      await apiRequest('DELETE', `http://localhost/api/user/addresses/${createdId}`, { sid }) as any,
      { params: Promise.resolve({ id: createdId }) }
    )
    expect(res.status).toBe(200)
    expect(await db.queryCount('SELECT count(*) FROM addresses WHERE id = $1', [createdId])).toBe(0)
  })

  it('DELETE 404 for an unknown address', async () => {
    const res = await DELETE(
      await apiRequest('DELETE', 'http://localhost/api/user/addresses/00000000-0000-4000-dddd-000000000098', { sid }) as any,
      { params: Promise.resolve({ id: '00000000-0000-4000-dddd-000000000098' }) }
    )
    expect(res.status).toBe(404)
  })
})
