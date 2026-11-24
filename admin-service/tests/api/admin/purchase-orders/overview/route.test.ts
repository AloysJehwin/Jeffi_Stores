import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@jeffi/list-filters', () => ({
  PO_FIELDS: ['f'],
  PURCHASE_ORDERS_ENTITY: 'po-entity',
  normalizeQuery: vi.fn(() => ({ normalized: true })),
  filterScope: vi.fn(() => ({ where: 'x' })),
  canonicalQuery: vi.fn(() => 'status=open'),
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/overview/period', () => ({ parsePeriod: vi.fn(() => ({ from: 'F', to: 'T' })) }))
vi.mock('@/lib/overviews/purchase-orders', () => ({ getPurchaseOrderOverview: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/purchase-orders/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getPurchaseOrderOverview } from '@/lib/overviews/purchase-orders'
import { filterScope, canonicalQuery } from '@jeffi/list-filters'

const call = (qs = '') => GET(new NextRequest(`http://localhost/x${qs}`))

describe('GET /api/admin/purchase-orders/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
  })

  it('returns the auth response without querying (needs inventory:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'inventory:read')
    expect(getPurchaseOrderOverview).not.toHaveBeenCalled()
  })

  it('builds the overview for the period and filters', async () => {
    vi.mocked(getPurchaseOrderOverview).mockResolvedValue({ total: 3 } as never)
    const res = await call('?from=2025-01-01&to=2025-01-31')
    expect(await res.json()).toEqual({ total: 3 })
    expect(parsePeriod).toHaveBeenCalledWith('2025-01-01', '2025-01-31')
    expect(filterScope).toHaveBeenCalledWith('po-entity', { normalized: true }, { omit: ['ordered'] })
    expect(canonicalQuery).toHaveBeenCalledWith({ normalized: true }, ['f'], { omit: ['from', 'to'] })
    expect(getPurchaseOrderOverview).toHaveBeenCalledWith({ from: 'F', to: 'T' }, { where: 'x' }, 'status=open')
  })

  it('returns 500 when the overview fails', async () => {
    vi.mocked(getPurchaseOrderOverview).mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call()).status).toBe(500)
  })
})
