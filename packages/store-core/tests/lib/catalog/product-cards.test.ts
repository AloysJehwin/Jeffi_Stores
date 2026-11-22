import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn(),
}))
vi.mock('@/lib/catalog/homepage-data', () => ({
  buildProductCardSql: vi.fn(() => 'BUILT_SQL'),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_INCL_GST_SQL: 'INCL',
  VARIANT_MIN_PRICE_EX_GST_SQL: 'EXGST',
  VARIANT_MIN_MRP_SQL: 'MRP',
  VARIANT_STOCK_TOTAL_SQL: 'STOCK',
}))
vi.mock('@/lib/catalog/public-product', () => ({
  publicProducts: vi.fn((rows: any[]) => rows.map(r => ({ ...r, _public: true }))),
}))

import { getProductCards, getProductCardsByIds, TOTAL_SOLD_SQL } from '@/lib/catalog/product-cards'
import { queryMany } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { buildProductCardSql } from '@/lib/catalog/homepage-data'

beforeEach(() => {
  vi.mocked(queryMany).mockReset().mockResolvedValue([] as any)
  vi.mocked(getFeatureFlags).mockReset().mockResolvedValue({ gstEnabled: false } as any)
  vi.mocked(buildProductCardSql).mockClear()
})

describe('getProductCards', () => {
  it('builds SQL with incl-GST price when gstEnabled, limit placeholder after params', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'p1' }] as any)
    const out = await getProductCards({ where: 'W', orderBy: 'O', params: ['a', 'b'], limit: 5, gstEnabled: true })
    const [clause, deps] = vi.mocked(buildProductCardSql).mock.calls[0]
    expect(clause).toEqual({ where: 'W', orderBy: 'O', limit: '$3' })
    expect(deps.minPriceSql).toBe('INCL')
    expect(deps.totalSoldSql).toBe(TOTAL_SOLD_SQL)
    // db called with built sql and params + limit appended
    expect(vi.mocked(queryMany).mock.calls[0]).toEqual(['BUILT_SQL', ['a', 'b', 5]])
    // publicProducts applied
    expect(out).toEqual([{ id: 'p1', _public: true }])
  })

  it('uses ex-GST price when GST off and resolves flags when not passed', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: false } as any)
    await getProductCards({ where: 'W', orderBy: 'O', limit: 3 })
    expect(getFeatureFlags).toHaveBeenCalled()
    const [clause, deps] = vi.mocked(buildProductCardSql).mock.calls[0]
    expect(clause.limit).toBe('$1') // no params → limit is $1
    expect(deps.minPriceSql).toBe('EXGST')
  })
})

describe('getProductCardsByIds', () => {
  it('returns [] for no ids without querying', async () => {
    expect(await getProductCardsByIds([])).toEqual([])
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns rows in the requested id order, dropping missing', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'b' }, { id: 'a' }] as any)
    const out = await getProductCardsByIds(['a', 'b', 'c'], true)
    expect(out.map((r: any) => r.id)).toEqual(['a', 'b'])
    // where / params / limit reflect the ids
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual([['a', 'b', 'c'], 3])
  })
})
