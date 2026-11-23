import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/catalog/product-cards', () => ({
  cardPropsFor: vi.fn((rows: any[]) => rows),
  getProductCards: vi.fn(),
  getProductCardsByIds: vi.fn(),
}))
vi.mock('@/lib/catalog/product-offers', () => ({
  listOffersByIds: vi.fn(),
  offerHref: vi.fn((slug: string) => `/offers/${slug}`),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_STOCK_TOTAL_SQL: 'STK',
}))
vi.mock('@/lib/catalog/homepage-sections', () => ({
  configId: vi.fn((s: any, k: string) => s.config?.[k] ?? null),
  configIds: vi.fn((s: any, k: string) => s.config?.[k] ?? []),
  configNumber: vi.fn((s: any, k: string, fb: number) => s.config?.[k] ?? fb),
  safeHref: vi.fn((u: any) => (typeof u === 'string' && u ? u : null)),
  sectionLimit: vi.fn((s: any, fb: number) => s.config?.limit ?? fb),
  slidesConfig: vi.fn((s: any) => ({ items: s.config?.items ?? [], layout: 'cards' })),
  spotlightConfig: vi.fn((s: any) => ({ productId: s.config?.productId ?? null })),
  valueStatMetrics: vi.fn((s: any) => s.config?.metrics ?? []),
}))

import {
  getCountdownDeal,
  getTestimonials,
  getCategoryTabs,
  getBundles,
  getBackInStock,
  getValueStats,
  getSpotlightProduct,
  getSlides,
  loadSectionExtras,
} from '@/lib/catalog/homepage-extras'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getProductCards, getProductCardsByIds } from '@/lib/catalog/product-cards'
import { listOffersByIds } from '@/lib/catalog/product-offers'

beforeEach(() => {
  vi.mocked(queryMany).mockReset().mockResolvedValue([] as any)
  vi.mocked(queryOne).mockReset().mockResolvedValue(null as any)
  vi.mocked(getProductCards).mockReset().mockResolvedValue([] as any)
  vi.mocked(getProductCardsByIds).mockReset().mockResolvedValue([] as any)
  vi.mocked(listOffersByIds).mockReset().mockResolvedValue([] as any)
})

describe('getCountdownDeal', () => {
  it('null without a productId', async () => {
    expect(await getCountdownDeal({ type: 'countdown_deal', config: {} } as any, true)).toBeNull()
  })

  it('null when the countdown already ended', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    expect(await getCountdownDeal({ config: { productId: 'p1', endsAt: past } } as any, true)).toBeNull()
    expect(getProductCardsByIds).not.toHaveBeenCalled()
  })

  it('returns product + endsAt when valid and product found', async () => {
    const future = new Date(Date.now() + 100000).toISOString()
    vi.mocked(getProductCardsByIds).mockResolvedValue([{ id: 'p1' }] as any)
    const out = await getCountdownDeal({ config: { productId: 'p1', endsAt: future } } as any, true)
    expect(out).toEqual({ product: { id: 'p1' }, endsAt: future })
  })

  it('treats a non-ISO endsAt as null and still returns the product', async () => {
    vi.mocked(getProductCardsByIds).mockResolvedValue([{ id: 'p1' }] as any)
    const out = await getCountdownDeal({ config: { productId: 'p1', endsAt: 'junk' } } as any, true)
    expect(out).toEqual({ product: { id: 'p1' }, endsAt: null })
  })

  it('null when the product is gone', async () => {
    const future = new Date(Date.now() + 100000).toISOString()
    vi.mocked(getProductCardsByIds).mockResolvedValue([] as any)
    expect(await getCountdownDeal({ config: { productId: 'p1', endsAt: future } } as any, true)).toBeNull()
  })
})

describe('getTestimonials', () => {
  it('maps rows and formats the reviewer name', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'r1', rating: '5', title: ' Great ', comment: ' nice ', is_verified_purchase: true, product_name: 'P', product_slug: 'p', first_name: 'Asha', last_name: 'Kumar' },
      { id: 'r2', rating: 4, title: null, comment: 'ok', is_verified_purchase: 0, product_name: 'Q', product_slug: 'q', first_name: '', last_name: null },
      { id: 'r3', rating: 4, title: '', comment: 'c', is_verified_purchase: 1, product_name: 'R', product_slug: 'r', first_name: 'Bob', last_name: '' },
    ] as any)
    const out = await getTestimonials({ config: {} } as any)
    expect(out[0]).toMatchObject({ rating: 5, title: 'Great', comment: 'nice', author: 'Asha K.', verified: true })
    expect(out[1]).toMatchObject({ author: 'A customer', title: null, verified: false })
    expect(out[2]).toMatchObject({ author: 'Bob' })
  })
})

describe('getCategoryTabs', () => {
  it('uses picked categories in order, dropping those with no products', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'c2', name: 'Two', slug: 'two' },
      { id: 'c1', name: 'One', slug: 'one' },
    ] as any)
    vi.mocked(getProductCards).mockImplementation(async (opts: any) =>
      opts.params[0] === 'c1' ? ([{ id: 'x' }] as any) : ([] as any)
    )
    const out = await getCategoryTabs({ config: { categoryIds: ['c1', 'c2'], tabs: 4 } } as any, true)
    expect(out.map(t => t.id)).toEqual(['c1']) // c2 has no products
    expect(out[0].products).toEqual([{ id: 'x' }])
  })

  it('falls back to top-level categories when none picked', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'c1', name: 'One', slug: 'one' }] as any)
    vi.mocked(getProductCards).mockResolvedValue([{ id: 'p' }] as any)
    const out = await getCategoryTabs({ config: {} } as any, false)
    const sql = String(vi.mocked(queryMany).mock.calls[0][0])
    expect(sql).toContain('c.parent_category_id IS NULL')
    expect(out).toHaveLength(1)
  })
})

describe('getBundles', () => {
  it('picked product ids, sliced to the limit', async () => {
    vi.mocked(getProductCardsByIds).mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any)
    const out = await getBundles({ config: { productIds: ['a', 'b', 'c'], limit: 2 } } as any, true)
    expect(out.map((p: any) => p.id)).toEqual(['a', 'b'])
  })

  it('queries is_bundle products when none picked', async () => {
    vi.mocked(getProductCards).mockResolvedValue([{ id: 'z' }] as any)
    await getBundles({ config: {} } as any, true)
    expect(vi.mocked(getProductCards).mock.calls[0][0].where).toContain('p.is_bundle = true')
  })
})

describe('getBackInStock', () => {
  it('passes the restock window and in-stock clause to getProductCards', async () => {
    vi.mocked(getProductCards).mockResolvedValue([{ id: 'b' }] as any)
    const out = await getBackInStock({ config: { days: 30 } } as any, true)
    const opts = vi.mocked(getProductCards).mock.calls[0][0] as any
    expect(opts.params).toEqual([30])
    expect(opts.where).toContain('inventory_transactions')
    expect(opts.orderBy).toContain('back_in_stock_notify')
    expect(out).toEqual([{ id: 'b' }])
  })
})

describe('getValueStats', () => {
  it('[] when no metrics picked', async () => {
    expect(await getValueStats({ config: { metrics: [] } } as any)).toEqual([])
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('keeps only metrics with a positive value', async () => {
    vi.mocked(queryOne).mockResolvedValue({ products: '12', cities: '0', orders_shipped: '5' } as any)
    const out = await getValueStats({
      config: { metrics: [{ metric: 'products', label: 'Products' }, { metric: 'cities', label: 'Cities' }, { metric: 'orders_shipped', label: 'Shipped' }] },
    } as any)
    expect(out).toEqual([
      { metric: 'products', label: 'Products', value: 12 },
      { metric: 'orders_shipped', label: 'Shipped', value: 5 },
    ])
  })

  it('treats a null row as zero values', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await getValueStats({ config: { metrics: [{ metric: 'products', label: 'P' }] } } as any)).toEqual([])
  })
})

describe('getSpotlightProduct', () => {
  it('null without a productId', async () => {
    expect(await getSpotlightProduct({ config: {} } as any, true)).toBeNull()
  })
  it('wraps the found product, null when gone', async () => {
    vi.mocked(getProductCardsByIds).mockResolvedValue([{ id: 's1' }] as any)
    expect(await getSpotlightProduct({ config: { productId: 's1' } } as any, true)).toEqual({ product: { id: 's1' } })
    vi.mocked(getProductCardsByIds).mockResolvedValue([] as any)
    expect(await getSpotlightProduct({ config: { productId: 's1' } } as any, true)).toBeNull()
  })
})

describe('getSlides', () => {
  it('resolves offer / category / product / custom items, dropping gone ones', async () => {
    vi.mocked(listOffersByIds).mockResolvedValue([
      { id: 'o1', slug: 'deal', title: 'Deal', subtitle: 'sub', badge_text: 'B', badge_color: 'bg-red', cta_label: 'Go', image_url: 'img', blurhash: 'bh', image_url_card: 'card', blurhash_card: 'bhc', video_url: '/v.mp4', video_url_card: null },
    ] as any)
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'cat1', name: 'Cat', slug: 'cat', image_url: null, product_image: 'pimg', product_blurhash: 'pbh', product_count: 3 },
    ] as any)
    vi.mocked(getProductCardsByIds).mockResolvedValue([
      { id: 'p1', name: 'Prod', slug: 'prod', brandName: 'Brand', categoryName: 'C', mrpDiscount: 10, primaryImage: { image_url: 'pi', blurhash: 'pbh2' }, displayPrice: 99, mrp: 120 },
    ] as any)

    const items = [
      { kind: 'offer', id: 's1', offerId: 'o1' },
      { kind: 'offer', id: 's2', offerId: 'gone' },
      { kind: 'category', id: 's3', categoryId: 'cat1' },
      { kind: 'product', id: 's4', productId: 'p1' },
      { kind: 'custom', id: 's5', url: '/c', title: 'Custom', eyebrow: 'E', sub: 'S', ctaLabel: 'CTA', image: 'ci', imageCard: 'cc', video: '/cv', videoCard: '/cvc', motion: 'kenburns' },
    ]
    const out = await getSlides({ config: { items } } as any, true)
    expect(out.slides.map((s: any) => s.id)).toEqual(['s1', 's3', 's4', 's5'])

    const offer = out.slides[0] as any
    expect(offer.kind).toBe('offer')
    expect(offer.href).toBe('/offers/deal')
    expect(offer.badgeClass).toBe('bg-red')
    expect(offer.image).toBe('img')

    const cat = out.slides[1] as any
    expect(cat.href).toBe('/categories/cat')
    expect(cat.sub).toBe('3 products')
    expect(cat.image).toBe('pimg')

    const prod = out.slides[2] as any
    expect(prod.href).toBe('/products/prod')
    expect(prod.eyebrow).toBe('Brand')
    expect(prod.badge).toBe('10% off')
    expect(prod.price).toBe(99)

    const custom = out.slides[3] as any
    expect(custom.kind).toBe('custom')
    expect(custom.href).toBe('/c')
    expect(custom.motion).toBe('kenburns')
  })

  it('drops a category with zero products and offers with no badge/discount fall to null', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'cat0', name: 'Empty', slug: 'empty', image_url: 'own', product_image: null, product_blurhash: null, product_count: 0 },
    ] as any)
    const out = await getSlides({ config: { items: [{ kind: 'category', id: 's', categoryId: 'cat0' }] } } as any, true)
    expect(out.slides).toHaveLength(0)
  })

  it('uses mobile image when the offer has no wide image, and null badge when discount 0', async () => {
    vi.mocked(listOffersByIds).mockResolvedValue([
      { id: 'o1', slug: 'd', title: 'T', subtitle: null, badge_text: 'x', badge_color: 'red', cta_label: null, image_url: null, image_url_mobile: 'mob', blurhash_mobile: 'mbh', image_url_card: null, video_url: null, video_url_card: null },
    ] as any)
    const out = await getSlides({ config: { items: [{ kind: 'offer', id: 's', offerId: 'o1' }] } } as any, true)
    const s = out.slides[0] as any
    expect(s.image).toBe('mob')
    expect(s.badgeClass).toBeNull() // badge_color not bg-*
  })
})

describe('loadSectionExtras', () => {
  it('loads known types by id and skips unknown ones', async () => {
    vi.mocked(queryOne).mockResolvedValue({ products: '3' } as any)
    const sections = [
      { id: 'vs', type: 'value_stats', config: { metrics: [{ metric: 'products', label: 'P' }] } },
      { id: 'unknown', type: 'not_a_loader', config: {} },
    ]
    const map = await loadSectionExtras(sections as any, true)
    expect(map.has('vs')).toBe(true)
    expect(map.has('unknown')).toBe(false)
  })

  it('skips a section whose loader throws', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const map = await loadSectionExtras([{ id: 'vs', type: 'value_stats', config: { metrics: [{ metric: 'products', label: 'P' }] } }] as any, true)
    expect(map.has('vs')).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
