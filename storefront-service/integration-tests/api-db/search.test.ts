// @vitest-environment node
//
// DB-backed API test (jeffi_test) — storefront public search. The GET handler runs real catalogue SQL
// (products/categories/brands) against jeffi_test and fire-and-forgets a search_logs row. It reads the
// session_id cookie via next/headers cookies() (request-scoped), so we mock ONLY next/headers to feed it;
// the catalogue queries, getFeatureFlags and the search_logs insert all run their real SQL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

let sessionCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => (name === 'session_id' && sessionCookie ? { value: sessionCookie } : undefined),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

// Poll for the async (void-dispatched) search_logs insert to land.
async function waitForLog(
  db: typeof import('@/lib/shared/db'),
  query: string,
  sessionId: string
): Promise<{ query: string; results_count: number; session_id: string | null } | null> {
  for (let i = 0; i < 40; i++) {
    const row = await db.queryOne<{ query: string; results_count: number; session_id: string | null }>(
      'SELECT query, results_count, session_id FROM search_logs WHERE query = $1 AND session_id = $2 ORDER BY created_at DESC LIMIT 1',
      [query, sessionId]
    )
    if (row) return row
    await new Promise(r => setTimeout(r, 25))
  }
  return null
}

describe.skipIf(!API_DB_ENABLED)('search API (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  const sid1 = 'apitest-sess-' + crypto.randomBytes(6).toString('hex')
  const sid2 = 'apitest-sess-' + crypto.randomBytes(6).toString('hex')
  const sid3 = 'apitest-sess-' + crypto.randomBytes(6).toString('hex')

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const route = await import('@storefront/app/api/(public)/search/route')
    GET = route.GET as any
    // Clean any stale logs from a prior run of these ids.
    await db.query('DELETE FROM search_logs WHERE session_id = ANY($1)', [[sid1, sid2, sid3]]).catch(() => {})
  })

  afterAll(async () => {
    await db.query('DELETE FROM search_logs WHERE session_id = ANY($1)', [[sid1, sid2, sid3]]).catch(() => {})
    await endPool()
  })

  it('returns the matching fixture product for a real query', async () => {
    sessionCookie = sid1
    const res = await GET(await apiRequest('GET', 'http://localhost/api/search?q=bolt') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
    expect(Array.isArray(body.categories)).toBe(true)
    expect(Array.isArray(body.brands)).toBe(true)
    // "API Test Bolt" (FIXTURES.product1) should surface.
    const ids = body.products.map((p: any) => p.id)
    expect(ids).toContain(FIXTURES.product1)
    const bolt = body.products.find((p: any) => p.id === FIXTURES.product1)
    expect(bolt.name).toBe('API Test Bolt')
    expect(Array.isArray(bolt.product_images)).toBe(true)
  })

  it('writes a real search_logs row (DB side-effect)', async () => {
    sessionCookie = sid2
    const res = await GET(await apiRequest('GET', 'http://localhost/api/search?q=nut') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const matchCount = body.products.length + body.categories.length + body.brands.length
    const row = await waitForLog(db, 'nut', sid2)
    expect(row).toBeTruthy()
    expect(row!.session_id).toBe(sid2)
    expect(row!.results_count).toBe(matchCount)
  })

  it('short query (< 2 chars) returns empty payload and logs nothing', async () => {
    sessionCookie = sid3
    const res = await GET(await apiRequest('GET', 'http://localhost/api/search?q=a') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual([])
    expect(body.categories).toEqual([])
    expect(body.brands).toEqual([])
    // No log row for a short-circuited query.
    await new Promise(r => setTimeout(r, 150))
    const n = await db.queryCount('SELECT count(*) FROM search_logs WHERE session_id = $1', [sid3])
    expect(n).toBe(0)
  })

  it('missing q param returns empty payload', async () => {
    sessionCookie = undefined
    const res = await GET(await apiRequest('GET', 'http://localhost/api/search') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual([])
    expect(body.categories).toEqual([])
    expect(body.brands).toEqual([])
  })

  it('no match returns empty product list but still 200', async () => {
    sessionCookie = undefined
    const res = await GET(
      await apiRequest('GET', 'http://localhost/api/search?q=zzqxnotathing') as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual([])
  })
})
