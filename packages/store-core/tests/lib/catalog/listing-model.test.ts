import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_INCL_GST_SQL: `INCL_SQL`,
  VARIANT_MIN_PRICE_EX_GST_SQL: `EX_SQL`,
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: false }),
}))
vi.mock('@/lib/catalog/search', () => ({
  buildProductSearchClause: vi.fn(() => ({ clause: 'SEARCH_CLAUSE', params: ['q'], nextIdx: 99 })),
  buildProductSearchRank: vi.fn(() => ({ rank: 'RANK_SQL', params: ['rank'] })),
}))
vi.mock('@/lib/catalog/product-filters', () => ({
  buildProductFilterClauses: vi.fn(() => ({ conditions: [], params: [], nextIdx: 1 })),
  getFilterFacets: vi.fn().mockResolvedValue({ brands: [], priceMin: 0, priceMax: 0 }),
}))
vi.mock('@/lib/catalog/product-offers', () => ({
  getOfferBySlug: vi.fn().mockResolvedValue(null),
  listFilterOffers: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/catalog/product-card-props', () => ({
  cardPropsFor: vi.fn((rows: any[]) => rows.map((r, i) => ({ id: r.id, displayPrice: 100 + i }))),
}))
vi.mock('@/lib/catalog/pricing', () => ({
  pickUnitPrice: vi.fn(({ inclusive }: any) => inclusive),
}))
vi.mock('@/lib/catalog/gst', () => ({
  round2: vi.fn((n: number) => Math.round(n * 100) / 100),
}))
vi.mock('@/lib/catalog/product-sort', () => ({
  positiveInt: vi.fn((v: unknown, d: number) => (v ? Number(v) : d)),
  productOrderBy: vi.fn(() => 'ORDER_SQL'),
  productSortSql: vi.fn(() => ''),
}))
vi.mock('@/lib/catalog/public-product', () => ({
  publicProducts: vi.fn((rows: any[]) => rows),
}))

import { getListingProducts, buildListingModel, toListingModelJson, LISTING_PAGE_SIZE } from '@/lib/catalog/listing-model'
import { queryMany, queryOne } from '@/lib/shared/db'
import { buildProductFilterClauses } from '@/lib/catalog/product-filters'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/catalog/search'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { productSortSql } from '@/lib/catalog/product-sort'
import { listFilterOffers, getOfferBySlug } from '@/lib/catalog/product-offers'

beforeEach(() => {
  vi.mocked(queryMany).mockReset().mockResolvedValue([])
  vi.mocked(queryOne).mockReset().mockResolvedValue(null)
  vi.mocked(buildProductFilterClauses).mockReset().mockReturnValue({ conditions: [], params: [], nextIdx: 1 })
  vi.mocked(getFeatureFlags).mockReset().mockResolvedValue({ gstEnabled: false } as any)
  vi.mocked(productSortSql).mockReset().mockReturnValue('' as any)
  vi.mocked(listFilterOffers).mockReset().mockResolvedValue([] as any)
  vi.mocked(getOfferBySlug).mockReset().mockResolvedValue(null as any)
  vi.mocked(buildProductSearchClause).mockReset().mockReturnValue({ clause: 'SEARCH_CLAUSE', params: ['q'], nextIdx: 99 } as any)
  vi.mocked(buildProductSearchRank).mockReset().mockReturnValue({ rank: 'RANK_SQL', params: ['rank'] } as any)
})

describe('getListingProducts', () => {
  it('returns products, total and gstEnabled; always filters to active', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '3' } as any)
    vi.mocked(queryMany).mockResolvedValue([{ id: 'p1' }])
    const r = await getListingProducts({})
    expect(r.total).toBe(3)
    expect(r.products).toEqual([{ id: 'p1' }])
    expect(r.gstEnabled).toBe(false)
    const countSql = String(vi.mocked(queryOne).mock.calls[0][0])
    expect(countSql).toContain('p.is_active = true')
  })

  it('builds a recursive category subtree for a single category id', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    await getListingProducts({ category: 'tools' })
    const countParams = vi.mocked(queryOne).mock.calls[0][1]
    expect(countParams).toEqual(['tools'])
    expect(String(vi.mocked(queryOne).mock.calls[0][0])).toContain('WITH RECURSIVE cat_tree')
  })

  it('handles a multi-category OR list and a brand list', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    await getListingProducts({ category: 'a,b', brand: 'nike' })
    const sql = String(vi.mocked(queryOne).mock.calls[0][0])
    expect(sql).toContain('p.category_id IN (SELECT id FROM categories WHERE')
    expect(sql).toContain('p.brand_id IN (SELECT id FROM brands WHERE')
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['a', 'b', 'nike'])
  })

  it('appends a search clause and, when unsorted, a search rank with its own params', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(productSortSql).mockReturnValue('' as any) // no explicit sort -> relevance fallback
    vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true } as any)
    await getListingProducts({ search: 'bolt' })
    expect(buildProductSearchClause).toHaveBeenCalled()
    expect(buildProductSearchRank).toHaveBeenCalled()
    // rank params appended after clause params in the list query
    const listParams = vi.mocked(queryMany).mock.calls[0][1]
    expect(listParams).toContain('rank')
    // gst on -> inclusive min price SQL selected
    expect(String(vi.mocked(queryMany).mock.calls[0][0])).toContain('INCL_SQL')
  })

  it('skips the search rank when an explicit sort is present', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(productSortSql).mockReturnValue('p.name ASC' as any)
    await getListingProducts({ search: 'bolt' })
    expect(buildProductSearchRank).not.toHaveBeenCalled()
  })
})

describe('buildListingModel', () => {
  it('assembles the full model including facets, categories, brands and banners', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '1' } as any)
    // getProducts list, getCategories, getBrands, getCategoryBanners cats
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ id: 'p1' }]) // products
      .mockResolvedValueOnce([{ id: 'c1', name: 'Cat', slug: 'cat' }]) // categories
      .mockResolvedValueOnce([{ id: 'b1', name: 'Brand' }]) // brands
      .mockResolvedValueOnce([{ id: 'cb', name: 'Banner', slug: 'banner' }]) // banner cats
      .mockResolvedValueOnce([{ id: 'x' }, { id: 'y' }]) // banner products (>=2 keeps it)
    const m = await buildListingModel({})
    expect(m.total).toBe(1)
    expect(m.start).toBe(1)
    expect(m.end).toBe(1)
    expect(m.categories).toHaveLength(1)
    expect(m.brands).toHaveLength(1)
    expect(m.categoryBanners).toHaveLength(1)
    expect(m.facets).toBeTruthy()
  })

  it('skips banners when categoryBanners is false', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    const m = await buildListingModel({}, { categoryBanners: false })
    expect(m.categoryBanners).toEqual([])
  })

  it('drops a banner category with fewer than two products', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([]) // products
      .mockResolvedValueOnce([]) // categories
      .mockResolvedValueOnce([]) // brands
      .mockResolvedValueOnce([{ id: 'cb', name: 'B', slug: 'b' }]) // banner cat
      .mockResolvedValueOnce([{ id: 'only-one' }]) // one product -> dropped
    const m = await buildListingModel({})
    expect(m.categoryBanners).toEqual([])
  })

  it('keeps a selected ended offer appended to the live offers', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(listFilterOffers).mockResolvedValue([{ slug: 'live', title: 'Live' }] as any)
    vi.mocked(getOfferBySlug).mockResolvedValue({ slug: 'ended', title: 'Ended' } as any)
    const m = await buildListingModel({ offer: 'ended' }, { categoryBanners: false })
    expect(m.filterOffers).toEqual([
      { slug: 'live', title: 'Live' },
      { slug: 'ended', title: 'Ended' },
    ])
  })

  it('does not duplicate an offer already live', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(listFilterOffers).mockResolvedValue([{ slug: 'live', title: 'Live' }] as any)
    vi.mocked(getOfferBySlug).mockResolvedValue({ slug: 'live', title: 'Live' } as any)
    const m = await buildListingModel({ offer: 'live' }, { categoryBanners: false })
    expect(m.filterOffers).toEqual([{ slug: 'live', title: 'Live' }])
  })

  it('builds facet base conditions for multi-category and brand', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    const { getFilterFacets } = await import('@/lib/catalog/product-filters')
    await buildListingModel({ category: 'a,b', brand: 'x' }, { categoryBanners: false })
    const [conds, params] = vi.mocked(getFilterFacets).mock.calls.at(-1)!
    expect(conds[0]).toBe('p.is_active = true')
    expect(params).toEqual(['a', 'b', 'x'])
  })

  it('builds a recursive facet condition for a single category', async () => {
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    const { getFilterFacets } = await import('@/lib/catalog/product-filters')
    await buildListingModel({ category: 'solo' }, { categoryBanners: false })
    const [conds, params] = vi.mocked(getFilterFacets).mock.calls.at(-1)!
    expect(conds.some(c => c.includes('WITH RECURSIVE cat_tree'))).toBe(true)
    expect(params).toEqual(['solo'])
  })
})

describe('toListingModelJson', () => {
  const baseModel = (over: Partial<any> = {}) => ({
    products: [],
    total: 0,
    page: 1,
    totalPages: 0,
    start: 0,
    end: 0,
    gstEnabled: true,
    categories: [],
    brands: [],
    categoryBanners: [],
    facets: { brands: [] } as any,
    filterOffers: [],
    ...over,
  })

  it('maps non-variant product MRP and discount', () => {
    const json = toListingModelJson(
      baseModel({
        products: [{ id: 'p1', has_variants: false, mrp: 200, gst_percentage: 0, categories: { id: 'c', slug: 's' }, handling_days: 5 }],
      }) as any
    )
    expect(json.products[0].mrp).toBe(200)
    // displayPrice from cardPropsFor = 100; discount = round((200-100)/200*100) = 50
    expect(json.products[0].mrpDiscount).toBe(50)
    expect(json.products[0].categoryId).toBe('c')
    expect(json.products[0].handlingDays).toBe(5)
    expect(json.pageSize).toBe(LISTING_PAGE_SIZE)
  })

  it('uses the cheapest variant MRP for a variant product', () => {
    const json = toListingModelJson(
      baseModel({ products: [{ id: 'p1', has_variants: true, variant_min_mrp: '150', gst_percentage: 0 }] }) as any
    )
    expect(json.products[0].mrp).toBe(150)
  })

  it('converts MRP to ex-GST when GST display is off', () => {
    const json = toListingModelJson(
      baseModel({ gstEnabled: false, products: [{ id: 'p1', has_variants: false, mrp: 118, gst_percentage: 18 }] }) as any
    )
    // 118 / 1.18 = 100
    expect(json.products[0].mrp).toBe(100)
  })

  it('zeroes discount when mrp is not above price', () => {
    const json = toListingModelJson(
      baseModel({ products: [{ id: 'p1', has_variants: false, mrp: 50, gst_percentage: 0 }] }) as any
    )
    expect(json.products[0].mrpDiscount).toBe(0)
  })

  it('maps categories, brands and banner products with image + price', () => {
    const json = toListingModelJson(
      baseModel({
        categories: [{ id: 'c1', name: 'C', slug: 'c', parent_category_id: null, display_order: 2 }],
        brands: [{ id: 'b1', name: 'B' }],
        categoryBanners: [
          {
            id: 'cb',
            name: 'Banner',
            slug: 'banner',
            products: [
              { id: 'x', name: 'X', slug: 'x', has_variants: true, variant_min_price: '80', product_images: [{ image_url: 'u', thumbnail_url: 't' }] },
              { id: 'y', name: 'Y', slug: 'y', has_variants: false, base_price: 60, product_images: [] },
            ],
          },
        ],
        filterOffers: [{ slug: 'o', title: 'O' }],
      }) as any
    )
    expect(json.categories[0]).toMatchObject({ id: 'c1', display_order: 2 })
    expect(json.brands[0]).toEqual({ id: 'b1', name: 'B' })
    const banner = json.categoryBanners[0]
    expect(banner.products[0]).toMatchObject({ id: 'x', displayPrice: 80, image: { image_url: 'u', thumbnail_url: 't' } })
    expect(banner.products[1]).toMatchObject({ id: 'y', displayPrice: 60, image: null })
    expect(json.offers).toEqual([{ slug: 'o', title: 'O' }])
  })
})
