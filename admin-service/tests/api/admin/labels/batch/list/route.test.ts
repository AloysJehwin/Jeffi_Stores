import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/search', () => ({
  buildProductSearchClause: vi.fn(() => ({ clause: 'SEARCH', params: ['s1'], nextIdx: 3 })),
  buildProductSearchRank: vi.fn(() => ({ rank: 'RANK', params: ['r1'] })),
}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/labels/batch/list/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/labels/batch/list${qs}`)

describe('GET labels/batch/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ id: 'b1', lot_number: 'L1' }] as any)
  })

  it('401s and 403s (labels:read)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'labels:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('lists perishable batches by expiry when there is no query', async () => {
    expect(await (await GET(req())).json()).toEqual({ batches: [{ id: 'b1', lot_number: 'L1' }] })
    const [sql, params] = vi.mocked(queryMany).mock.calls[0] as any
    expect(sql).toContain('p.perishable = true')
    expect(sql).toContain('ORDER BY pb.expiry_date ASC')
    expect(params).toEqual([])
  })

  it('filters by product and searches with a lot-number match and rank', async () => {
    await GET(req('?product_id=p1&q=milk'))
    const [sql, params] = vi.mocked(queryMany).mock.calls[0] as any
    expect(sql).toContain('pb.product_id = $1')
    expect(sql).toContain('pb.lot_number ILIKE $3')
    expect(sql).toContain('RANK ASC')
    expect(params).toEqual(['p1', 's1', '%milk%', 'r1'])
  })

  it('500s with the error message when the query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })
})
