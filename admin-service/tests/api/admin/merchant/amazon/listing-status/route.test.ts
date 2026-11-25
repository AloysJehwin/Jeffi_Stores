import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ authenticateAdmin: vi.fn(), summary: vi.fn(), page: vi.fn(), normalize: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/amazon/status', () => ({ getAmazonSummary: m.summary, getAmazonStatusPage: m.page }))
vi.mock('@jeffi/list-filters', () => ({ normalizeQuery: m.normalize }))
vi.mock('@/lib/filters/entities/amazon-listings', () => ({ AMAZON_LISTINGS_ENTITY: { name: 'amazon-listings' } }))

import { GET } from '@admin/app/api/(admin)/admin/merchant/amazon/listing-status/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:read'] }
const get = (qs = '') => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/merchant/amazon/listing-status${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAdmin.mockResolvedValue(ADMIN)
  m.normalize.mockReturnValue({ status: ['active'] })
  m.summary.mockResolvedValue({ active: 9, suppressed: 1 })
  m.page.mockResolvedValue({ rows: [{ sku: 'S1' }], total: 10 })
})

describe('merchant amazon listing-status route', () => {
  it('answers 401 signed out and 403 without merchant_sync:read', async () => {
    m.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    m.authenticateAdmin.mockResolvedValue({ ...ADMIN, scopes: ['orders:read'] })
    expect((await get()).status).toBe(403)
    expect(m.page).not.toHaveBeenCalled()
  })

  it('returns a page of listings with the summary, defaulting to page 1 of 50', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ summary: { active: 9, suppressed: 1 }, rows: [{ sku: 'S1' }], total: 10, page: 1, pageSize: 50 })
    expect(m.page).toHaveBeenCalledWith({ page: 1, pageSize: 50, filters: { status: ['active'] }, sort: expect.any(URLSearchParams) })
  })

  it('applies the requested page, page size and the tab filters to both queries', async () => {
    const res = await get('?page=3&pageSize=20&status=active')
    expect(await res.json()).toMatchObject({ page: 3, pageSize: 20 })
    expect(m.normalize).toHaveBeenCalledWith({ name: 'amazon-listings' }, expect.any(URLSearchParams))
    expect(m.summary).toHaveBeenCalledWith({ status: ['active'] })
    expect(m.page.mock.calls[0][0]).toMatchObject({ page: 3, pageSize: 20 })
  })
})
