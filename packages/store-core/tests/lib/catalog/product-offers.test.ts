import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

import {
  listActiveOffers,
  listFilterOffers,
  listOffersByIds,
  listOffersAdmin,
  getOfferBySlug,
  getOfferById,
  OFFER_SORT,
  offerHref,
  slugifyOffer,
} from '@/lib/catalog/product-offers'
import { queryMany, queryOne } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

beforeEach(() => {
  mockQueryMany.mockReset()
  mockQueryOne.mockReset()
})

describe('re-exports', () => {
  it('offerHref/slugifyOffer are re-exported', () => {
    expect(offerHref('x')).toBe('/products?offer=x')
    expect(slugifyOffer('A B')).toBe('a-b')
  })
})

describe('listActiveOffers', () => {
  it('selects live offers ordered for the slider', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'o1' }] as any)
    const out = await listActiveOffers()
    expect(out).toEqual([{ id: 'o1' }])
    const sql = mockQueryMany.mock.calls[0][0]
    expect(sql).toContain('FROM product_offers WHERE')
    expect(sql).toContain('is_active = true')
    expect(sql).toContain('ORDER BY display_order ASC, created_at ASC')
  })
})

describe('listFilterOffers', () => {
  it('requires an active product via EXISTS', async () => {
    mockQueryMany.mockResolvedValue([{ slug: 's', title: 't' }] as any)
    await listFilterOffers()
    const sql = mockQueryMany.mock.calls[0][0]
    expect(sql).toContain('EXISTS')
    expect(sql).toContain('product_offer_items')
  })
})

describe('listOffersByIds', () => {
  it('empty ids → no query', async () => {
    expect(await listOffersByIds([])).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })
  it('returns offers in the requested id order, dropping misses', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'b' }, { id: 'a' }] as any)
    const out = await listOffersByIds(['a', 'missing', 'b'])
    expect(out).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(mockQueryMany.mock.calls[0][1]).toEqual([['a', 'missing', 'b']])
  })
})

describe('listOffersAdmin', () => {
  it('groups with product_count and default order when no sort', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'o1', product_count: 3 }] as any)
    await listOffersAdmin()
    const sql = mockQueryMany.mock.calls[0][0]
    expect(sql).toContain('COUNT(i.product_id)::int AS product_count')
    expect(sql).toContain('GROUP BY o.id')
    expect(sql).toContain('ORDER BY o.display_order ASC, o.created_at ASC')
  })
  it('applies a chosen sort', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    await listOffersAdmin({ key: 'title', dir: 'asc' })
    const sql = mockQueryMany.mock.calls[0][0]
    expect(sql).toContain('o.title ASC NULLS LAST')
    expect(sql).toContain('o.id')
  })
  it('OFFER_SORT exposes the sortable columns', () => {
    expect(OFFER_SORT.sorts.products).toBe('COUNT(i.product_id)')
    expect(OFFER_SORT.tiebreak).toBe('o.id')
  })
})

describe('getOfferBySlug / getOfferById', () => {
  it('by slug', async () => {
    mockQueryOne.mockResolvedValue({ id: 'o1', slug: 's' } as any)
    expect(await getOfferBySlug('s')).toEqual({ id: 'o1', slug: 's' })
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['s'])
  })
  it('by id', async () => {
    mockQueryOne.mockResolvedValue(null as any)
    expect(await getOfferById('o1')).toBeNull()
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['o1'])
  })
})
