import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ authenticateAdmin: vi.fn(), summary: vi.fn(), page: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/merchant/gmc-status', () => ({ getGmcSummary: m.summary, getGmcStatusPage: m.page }))

import { GET } from '@admin/app/api/(admin)/admin/merchant/gmc-status/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:read'] }
const get = (qs = '') => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/merchant/gmc-status${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAdmin.mockResolvedValue(ADMIN)
  m.summary.mockResolvedValue({ approved: 20, disapproved: 2 })
  m.page.mockResolvedValue({ rows: [{ offerId: 'S1' }], total: 22 })
})

describe('merchant gmc-status route', () => {
  it('answers 401 signed out and 403 without merchant_sync:read', async () => {
    m.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    m.authenticateAdmin.mockResolvedValue({ ...ADMIN, scopes: ['orders:read'] })
    expect((await get()).status).toBe(403)
    expect(m.page).not.toHaveBeenCalled()
  })

  it('returns a page of product statuses with the summary, defaulting to page 1 of 50', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ summary: { approved: 20, disapproved: 2 }, rows: [{ offerId: 'S1' }], total: 22, page: 1, pageSize: 50 })
    expect(m.page).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: undefined, status: undefined, sort: expect.any(URLSearchParams) })
  })

  it('passes the page, page size, search and status filters through', async () => {
    const res = await get('?page=2&pageSize=10&search=tee&status=disapproved')
    expect(await res.json()).toMatchObject({ page: 2, pageSize: 10 })
    expect(m.page.mock.calls[0][0]).toMatchObject({ page: 2, pageSize: 10, search: 'tee', status: 'disapproved' })
  })
})
