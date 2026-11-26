// @vitest-environment node
//
// DB-backed API test (jeffi_test tier): every Overview's insights series route runs its SQL against the real
// schema, for each filter, and returns a Monday-aligned grid with one value per series.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const PAGES: { page: string; scope: string; filters: string[]; series: number }[] = [
  { page: 'orders', scope: 'orders:read', filters: ['all', 'online', 'cod', 'business'], series: 3 },
  { page: 'invoices', scope: 'invoices:read', filters: ['all', 'b2b', 'b2c'], series: 3 },
  { page: 'quotations', scope: 'quotations:read', filters: [], series: 2 },
  { page: 'cash-sale', scope: 'invoices:read', filters: [], series: 3 },
  { page: 'purchase-orders', scope: 'inventory:read', filters: [], series: 3 },
  { page: 'returns', scope: 'returns:read', filters: [], series: 3 },
  { page: 'replacements', scope: 'replacements:read', filters: [], series: 3 },
  { page: 'subscriptions', scope: 'subscriptions:read', filters: ['all', 'razorpay', 'phonepe'], series: 3 },
  { page: 'financial', scope: 'financial:read', filters: ['all', 'online', 'business', 'offline'], series: 2 },
  { page: 'coupons', scope: 'coupons:read', filters: [], series: 2 },
]

describe.skipIf(!API_DB_ENABLED)('overview insights API (real DB)', () => {
  const GETS: Record<string, (req: any) => Promise<Response>> = {}
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  let narrowSid = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    GETS.orders = (await import('@admin/app/api/(admin)/admin/orders/insights/route')).GET as any
    GETS.invoices = (await import('@admin/app/api/(admin)/admin/invoices/insights/route')).GET as any
    GETS.quotations = (await import('@admin/app/api/(admin)/admin/quotations/insights/route')).GET as any
    GETS['cash-sale'] = (await import('@admin/app/api/(admin)/admin/cash-sale/insights/route')).GET as any
    GETS['purchase-orders'] = (await import('@admin/app/api/(admin)/admin/purchase-orders/insights/route')).GET as any
    GETS.returns = (await import('@admin/app/api/(admin)/admin/returns/insights/route')).GET as any
    GETS.replacements = (await import('@admin/app/api/(admin)/admin/replacements/insights/route')).GET as any
    GETS.subscriptions = (await import('@admin/app/api/(admin)/admin/subscriptions/insights/route')).GET as any
    GETS.financial = (await import('@admin/app/api/(admin)/admin/financial/insights/route')).GET as any
    GETS.coupons = (await import('@admin/app/api/(admin)/admin/coupons/insights/route')).GET as any
    ;({ sid } = await makeAdminSession(auth, FIXTURES.adminId, PAGES.map(p => p.scope), 'manager'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['tasks:read'], 'manager'))
  }, 180_000)

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  for (const p of PAGES) {
    const url = (qs = '') => `http://localhost/api/admin/${p.page}/insights${qs}`

    it(`${p.page}: 401 without a session, 403 without ${p.scope}`, async () => {
      expect((await GETS[p.page](await apiRequest('GET', url()) as any)).status).toBe(401)
      expect((await GETS[p.page](await apiRequest('GET', url(), { sid: narrowSid }) as any)).status).toBe(403)
    })

    for (const filter of p.filters.length ? p.filters : [null]) {
      it(`${p.page}: 200 with a 26-week grid${filter ? ` for filter ${filter}` : ''}`, async () => {
        const res = await GETS[p.page](await apiRequest('GET', url(filter ? `?filter=${filter}` : ''), { sid }) as any)
        expect(res.status).toBe(200)
        const { series } = await res.json()
        expect(series.weeks).toBe(26)
        expect(series.filter).toBe(filter)
        expect(series.series).toHaveLength(p.series)
        expect(series.days).toHaveLength(26 * 7)
        for (const d of series.days.slice(0, 3)) expect(d.values).toHaveLength(p.series)
      })
    }
  }
})
