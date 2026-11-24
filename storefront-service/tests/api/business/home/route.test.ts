import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateBusiness = vi.hoisted(() => vi.fn())
const queryMany = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const getProductCardsByIds = vi.hoisted(() => vi.fn())
const getFeatureFlags = vi.hoisted(() => vi.fn())
const getHomepagePlan = vi.hoisted(() => vi.fn())
const businessOffersConfig = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateBusiness }))
vi.mock('@/lib/shared/db', () => ({ queryMany, queryOne }))
vi.mock('@/lib/catalog/product-cards', () => ({
  getProductCardsByIds,
  cardPropsFor: (cards: Array<{ id: string }>) => cards.map(c => ({ id: c.id })),
}))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags }))
vi.mock('@/lib/catalog/homepage-plan', () => ({ getHomepagePlan }))
vi.mock('@/lib/catalog/homepage-sections', () => ({ businessOffersConfig }))

import { GET } from '@storefront/app/api/(public)/business/home/route'

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/business/home${qs}`))
const UUID = '11111111-1111-1111-1111-111111111111'

describe('GET /api/business/home', () => {
  beforeEach(() => {
    authenticateBusiness.mockResolvedValue({ userId: 'b1', approvalStatus: 'approved' })
    getHomepagePlan.mockResolvedValue({ business: true })
    getFeatureFlags.mockResolvedValue({ gstEnabled: true })
    queryOne.mockResolvedValue({ company_name: 'Acme Ltd', gst_number: '22AAAAA0000A1Z5' })
    queryMany.mockResolvedValue([])
    getProductCardsByIds.mockImplementation(async (ids: string[]) => ids.map(id => ({ id })))
  })

  it('401s visitors', async () => {
    authenticateBusiness.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('403s a business that is not approved yet', async () => {
    authenticateBusiness.mockResolvedValue({ userId: 'b1', approvalStatus: 'pending' })
    expect((await get()).status).toBe(403)
  })

  it('403s when the plan has no business homepage', async () => {
    getHomepagePlan.mockResolvedValue({ business: false })
    expect((await get()).status).toBe(403)
  })

  it('returns only the company when no sections are requested', async () => {
    const res = await get()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ company: { name: 'Acme Ltd', gstNumber: '22AAAAA0000A1Z5' } })
  })

  it('loads reorder cards in most-ordered order', async () => {
    queryMany.mockResolvedValue([{ product_id: 'p2' }, { product_id: 'p1' }])
    const body = await (await get('?sections=reorder&reorderLimit=500')).json()
    expect(body.reorder).toEqual([{ id: 'p2' }, { id: 'p1' }])
    // limit is capped at 24
    expect(queryMany.mock.calls[0][1]).toEqual(['b1', 24])
  })

  it('loads open quotes and the account summary', async () => {
    queryMany.mockImplementation(async (sql: string) =>
      sql.includes('business_rfqs')
        ? [{ id: 'r1', rfq_number: 'RFQ-1', status: 'pending', item_count: 2, created_at: 'c' }]
        : [{ id: 'o1', order_number: 'ORD-1', status: 'shipped', total_amount: '120.50', created_at: 'd' }]
    )
    queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('business_profiles')) return { company_name: 'Acme', gst_number: null }
      if (sql.includes('business_rfqs')) return { n: 4 }
      return { n: 2, total: '300' }
    })
    const body = await (await get('?sections=account')).json()
    expect(body.quotes).toEqual({
      open: 4,
      items: [{ id: 'r1', rfqNumber: 'RFQ-1', status: 'pending', itemCount: 2, createdAt: 'c' }],
    })
    expect(body.account).toEqual({
      recentOrders: [{ id: 'o1', orderNumber: 'ORD-1', status: 'shipped', total: 120.5, createdAt: 'd' }],
      paymentsDue: { count: 2, total: 300 },
    })
  })

  it('loads picked and discount-driven offers, ignoring malformed section ids', async () => {
    businessOffersConfig.mockImplementation((s: { id: string }) =>
      s.id === UUID ? { source: 'picked', productIds: ['p1', 'p2', 'p3'], limit: 2 } : { source: 'discounts', productIds: [], limit: 5 }
    )
    queryMany.mockImplementation(async (sql: string) => {
      if (sql.includes('homepage_sections')) return [{ id: UUID, type: 'business_offers', config: {} }, { id: '22222222-2222-2222-2222-222222222222', type: 'business_offers', config: {} }]
      return [{ id: 'd1' }]
    })
    const body = await (await get(`?sections=offers&offers=${UUID},not-a-uuid`)).json()
    expect(body.offers[UUID]).toEqual([{ id: 'p1' }, { id: 'p2' }])
    expect(body.offers['22222222-2222-2222-2222-222222222222']).toEqual([{ id: 'd1' }])
    expect(queryMany.mock.calls[0][1]).toEqual([[UUID]])
  })

  it('500s when a query fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    queryOne.mockRejectedValue(new Error('db'))
    const res = await get('?sections=reorder')
    expect(res.status).toBe(500)
    expect(spy).toHaveBeenCalled()
  })
})
