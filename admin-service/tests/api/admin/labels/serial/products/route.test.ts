import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/search', () => ({
  buildProductSearchClause: vi.fn(() => ({ clause: 'SEARCH', params: ['s1'], nextIdx: 2 })),
  buildProductSearchRank: vi.fn(() => ({ rank: 'RANK', params: ['r1'] })),
}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/labels/serial/products/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/labels/serial/products${qs}`)

describe('GET labels/serial/products', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ product_id: 'p1', in_stock_count: 3 }] as any)
  })

  it('401s and 403s (labels:read)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'labels:read')
  })

  it('lists serialized products with in-stock counts, unfiltered', async () => {
    expect(await (await GET(req())).json()).toEqual({ products: [{ product_id: 'p1', in_stock_count: 3 }] })
    const [sql, params] = vi.mocked(queryMany).mock.calls[0] as any
    expect(sql).toContain("ps.status = 'in_stock'")
    expect(params).toEqual([])
  })

  it('searches by product or variant name with rank', async () => {
    await GET(req('?q=phone'))
    const [sql, params] = vi.mocked(queryMany).mock.calls[0] as any
    expect(sql).toContain('pv.variant_name ILIKE $2')
    expect(params).toEqual(['s1', '%phone%', 'r1'])
  })

  it('500s when the query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })
})
