import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
}))

import { listBrandsWithCounts, categoryProductCounts } from '@/lib/catalog/storefront-counts'
import { queryMany } from '@/lib/shared/db'

describe('listBrandsWithCounts', () => {
  beforeEach(() => vi.mocked(queryMany).mockReset())

  it('returns the rows and orders featured/display_order/name', async () => {
    const rows = [{ id: 'b1', name: 'Acme' }]
    vi.mocked(queryMany).mockResolvedValue(rows as any)
    const out = await listBrandsWithCounts()
    expect(out).toBe(rows)
    const sql = String(vi.mocked(queryMany).mock.calls[0][0])
    expect(sql).toContain("COUNT(p.id) FILTER (WHERE p.is_active = true) AS product_count")
    expect(sql).toContain('WHERE b.is_active = true')
    expect(sql).toContain('ORDER BY COALESCE(b.is_featured, false) DESC, COALESCE(b.display_order, 0) ASC, b.name ASC')
  })
})

describe('categoryProductCounts', () => {
  beforeEach(() => vi.mocked(queryMany).mockReset())

  it('maps category ids to integer counts', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { category_id: 'c1', count: '5' },
      { category_id: 'c2', count: '0' },
    ] as any)
    const out = await categoryProductCounts()
    expect(out).toEqual({ c1: 5, c2: 0 })
    const sql = String(vi.mocked(queryMany).mock.calls[0][0])
    expect(sql).toContain('WHERE is_active = true GROUP BY category_id')
  })

  it('returns an empty map when there are no rows', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    expect(await categoryProductCounts()).toEqual({})
  })
})
