import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/products/[id]/supplier-details/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne, queryMany } from '@/lib/shared/db'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const call = () => GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: 'p1' }) })

describe('GET /api/admin/products/[id]/supplier-details', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns empty aggregates when there is no data', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    vi.mocked(queryMany).mockResolvedValue([])
    const body = await (await call()).json()
    expect(body).toMatchObject({
      primarySupplier: null,
      suppliers: [],
      purchaseHistory: [],
      lastPurchasePrice: null,
      lastPurchaseDate: null,
      lowestHistoricalPrice: null,
    })
  })

  it('picks the cheapest supplier per leaf and last/lowest purchase prices', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 's1', name: 'Acme' })
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        { supplier_id: 's2', unit_cost: '90', variant_id: 'v1', sub_variant_id: null },
        { supplier_id: 's1', unit_cost: '70', variant_id: 'v1', sub_variant_id: null },
        { supplier_id: 's3', unit_cost: '10', variant_id: null, sub_variant_id: null },
      ])
      .mockResolvedValueOnce([
        { unit_cost: '80', order_date: '2025-02-01', supplier_name: 'B', variant_id: 'v1', sub_variant_id: null },
        { unit_cost: '60', order_date: '2025-01-01', supplier_name: 'A', variant_id: 'v1', sub_variant_id: null },
      ])
    const body = await (await call()).json()
    const NIL = '00000000-0000-0000-0000-000000000000'
    expect(body.suppliers.map((s: { supplier_id: string }) => s.supplier_id)).toEqual(['s3', 's1', 's2'])
    expect(body.bestByLeaf).toEqual({ [`v1:${NIL}`]: 's1', [`${NIL}:${NIL}`]: 's3' })
    expect(body.lastPurchaseByLeaf[`v1:${NIL}`]).toEqual({ price: 80, date: '2025-02-01', supplierName: 'B' })
    expect(body.lowestHistByLeaf[`v1:${NIL}`]).toBe(60)
    expect(body).toMatchObject({ lastPurchasePrice: 80, lastPurchaseDate: '2025-02-01', lowestHistoricalPrice: 60 })
  })

  it('returns 500 when a query fails', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('db'))
    vi.mocked(queryMany).mockResolvedValue([])
    expect((await call()).status).toBe(500)
  })
})
