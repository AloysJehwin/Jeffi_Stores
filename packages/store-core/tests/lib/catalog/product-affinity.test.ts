import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
}))

import { frequentlyBoughtWith, alsoViewedWith } from '@/lib/catalog/product-affinity'
import { queryMany } from '@/lib/shared/db'

beforeEach(() => vi.mocked(queryMany).mockReset())

describe('frequentlyBoughtWith', () => {
  it('returns [] without querying when productIds is empty', async () => {
    expect(await frequentlyBoughtWith([], 5)).toEqual([])
    expect(vi.mocked(queryMany)).not.toHaveBeenCalled()
  })

  it('maps rows to product ids and issues the co-purchase join with id/limit params', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ product_id: 'b' }, { product_id: 'c' }])
    const out = await frequentlyBoughtWith(['a'], 10)
    expect(out).toEqual(['b', 'c'])
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('FROM order_items oi1')
    expect(String(sql)).toContain("o.status <> 'cancelled'")
    expect(String(sql)).toContain('p.is_active = true')
    expect(params).toEqual([['a'], 10])
  })
})

describe('alsoViewedWith', () => {
  it('maps rows and issues the 90-day viewer-overlap query', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ product_id: 'x' }])
    const out = await alsoViewedWith('p1', 7)
    expect(out).toEqual(['x'])
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('WITH viewers AS')
    expect(String(sql)).toContain("interval '90 days'")
    expect(String(sql)).toContain('p.is_active = true')
    expect(params).toEqual(['p1', 7])
  })

  it('returns [] for no overlap rows', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    expect(await alsoViewedWith('p1', 7)).toEqual([])
  })
})
