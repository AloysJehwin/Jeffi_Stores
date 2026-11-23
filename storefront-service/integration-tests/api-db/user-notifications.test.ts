// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront /api/(public)/user/notifications
// (inbox list, mark-read, mark-opened). Real session, real notifications rows, real side-effects.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, cleanupRows, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('user notifications API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let listGET: (req: any) => Promise<Response>
  let readPOST: (req: any) => Promise<Response>
  let openedPOST: (req: any, ctx: any) => Promise<Response>
  let sid = ''
  const userId = FIXTURES.customerId
  // Group-4 must start 8/9/a/b to satisfy RFC-4122 (z.string().uuid()).
  const suffix = uniqueSuffix()
  const n1 = `00000000-0000-4000-a000-0000${suffix.slice(0, 8)}`
  const n2 = `00000000-0000-4000-a001-0000${suffix.slice(0, 8)}`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    listGET = (await import('@storefront/app/api/(public)/user/notifications/route')).GET as any
    readPOST = (await import('@storefront/app/api/(public)/user/notifications/read/route')).POST as any
    openedPOST = (await import('@storefront/app/api/(public)/user/notifications/[id]/opened/route')).POST as any
    ;({ sid } = await makeCustomerSession(auth, userId))
    await db.query('DELETE FROM notifications WHERE id = ANY($1::uuid[])', [[n1, n2]])
    await db.query(
      `INSERT INTO notifications (id, user_id, type, title, message, is_read)
       VALUES ($1,$3,'account','First','hello',false), ($2,$3,'account','Second','world',false)`,
      [n1, n2, userId]
    )
  })

  afterAll(async () => {
    await cleanupRows(db, [{ table: 'notifications', ids: [n1, n2] }])
    await endPool()
  })

  it('GET 401 without a session', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/user/notifications') as any)
    expect(res.status).toBe(401)
  })

  it('GET returns the seeded inbox with an unread count', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/user/notifications', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.unread_count).toBeGreaterThanOrEqual(2)
    const ids = body.items.map((i: any) => i.id)
    expect(ids).toContain(n1)
    expect(ids).toContain(n2)
  })

  it('read POST 400 when neither ids nor all is given', async () => {
    const res = await readPOST(await apiRequest('POST', 'http://localhost/api/user/notifications/read', { sid, body: {} }) as any)
    expect(res.status).toBe(400)
  })

  it('read POST marks one id read in the real table', async () => {
    const res = await readPOST(
      await apiRequest('POST', 'http://localhost/api/user/notifications/read', { sid, body: { ids: [n1] } }) as any
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ is_read: boolean }>('SELECT is_read FROM notifications WHERE id = $1', [n1])
    expect(row!.is_read).toBe(true)
    const stillUnread = await db.queryOne<{ is_read: boolean }>('SELECT is_read FROM notifications WHERE id = $1', [n2])
    expect(stillUnread!.is_read).toBe(false)
  })

  it('read POST with all:true clears remaining unread', async () => {
    const res = await readPOST(
      await apiRequest('POST', 'http://localhost/api/user/notifications/read', { sid, body: { all: true } }) as any
    )
    expect(res.status).toBe(200)
    const n = await db.queryCount(
      'SELECT count(*) FROM notifications WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_read = false',
      [userId, [n1, n2]]
    )
    expect(n).toBe(0)
  })

  it('opened POST 401 without a session', async () => {
    const res = await openedPOST(
      await apiRequest('POST', `http://localhost/api/user/notifications/${n2}/opened`) as any,
      { params: Promise.resolve({ id: n2 }) }
    )
    expect(res.status).toBe(401)
  })

  it('opened POST 404 for an unknown / non-owned id', async () => {
    const other = '00000000-0000-4000-a0ff-000000000000'
    const res = await openedPOST(
      await apiRequest('POST', `http://localhost/api/user/notifications/${other}/opened`, { sid }) as any,
      { params: Promise.resolve({ id: other }) }
    )
    expect(res.status).toBe(404)
  })

  it('opened POST stamps opened_at on the real row', async () => {
    const res = await openedPOST(
      await apiRequest('POST', `http://localhost/api/user/notifications/${n2}/opened`, { sid }) as any,
      { params: Promise.resolve({ id: n2 }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ opened_at: string | null }>('SELECT opened_at FROM notifications WHERE id = $1', [n2])
    expect(row!.opened_at).not.toBeNull()
  })
})
