import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/catalog/homepage-data', () => ({ buildProductRowSql: vi.fn(() => 'SELECT rows') }))
vi.mock('@/lib/catalog/homepage-sections', () => ({
  productSource: vi.fn(() => 'featured'),
  sectionLimit: vi.fn(() => 8),
  resolveAboutStats: vi.fn(() => []),
  configId: vi.fn(),
  friendlyCount: vi.fn((n: number) => String(n)),
  safeHref: vi.fn((u: string) => (u.startsWith('http') ? u : null)),
  motionHeroSlides: vi.fn(),
  storyGroups: vi.fn(),
  spotlightConfig: vi.fn(() => ({ productId: null })),
  slidesConfig: vi.fn(() => ({ items: [] })),
  SECTION_TYPES: ['product_row', 'recently_viewed', 'motion_hero', 'stories', 'blog_teaser', 'product_spotlight', 'unsupported'],
  SECTION_COPY_DEFAULTS: { about: { imageUrl: '/about.jpg' } },
  HOMEPAGE_AUDIENCES: ['all', 'new'],
  HOMEPAGE_SURFACES: ['website', 'app'],
  slidesForSurface: vi.fn(),
  rowAudience: vi.fn(() => 'all'),
  rowSurface: vi.fn(() => 'website'),
}))
vi.mock('@/lib/catalog/homepage-extras', () => ({
  getBackInStock: vi.fn(), getBundles: vi.fn(), getCategoryTabs: vi.fn(), getCountdownDeal: vi.fn(),
  getSlides: vi.fn(), getSpotlightProduct: vi.fn(), getTestimonials: vi.fn(), getValueStats: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_INCL_GST_SQL: 'incl', VARIANT_MIN_PRICE_EX_GST_SQL: 'ex', VARIANT_MIN_MRP_SQL: 'mrp', VARIANT_STOCK_TOTAL_SQL: 'stock',
}))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(), getStorefrontContent: vi.fn() }))
vi.mock('@/lib/catalog/homepage-draft', () => ({ getEditableHomepage: vi.fn(), homepageDraftIdFrom: vi.fn(() => null) }))
vi.mock('@/lib/catalog/product-offers', () => ({ listActiveOffers: vi.fn(), listOffersByIds: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/homepage/preview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { motionHeroSlides, storyGroups } from '@/lib/catalog/homepage-sections'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

const req = (qs: string) => new NextRequest(`http://localhost/api/admin/homepage/preview${qs}`)

describe('GET /api/admin/homepage/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true } as any)
  })

  it('401s and 403s (settings:write)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('?type=product_row'))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('?type=product_row'))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'settings:write')
  })

  it('400s on an unknown type or surface', async () => {
    expect((await GET(req('?type=bogus'))).status).toBe(400)
    expect((await GET(req(''))).status).toBe(400)
    expect((await GET(req('?type=product_row&surface=tv'))).status).toBe(400)
  })

  it('returns kind none for a section without a resolver', async () => {
    expect(await (await GET(req('?type=unsupported'))).json()).toEqual({ kind: 'none', items: [] })
  })

  it('explains that recently viewed has nothing to preview', async () => {
    const j = await (await GET(req('?type=recently_viewed'))).json()
    expect(j.kind).toBe('none')
    expect(j.note).toContain('recently viewed')
  })

  it('previews product rows from the database', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'p1', name: 'Shirt', variant_min_price: 499, product_images: [{ thumbnail_url: 't.jpg' }] }] as any)
    const j = await (await GET(req(`?type=product_row&config=${encodeURIComponent('{"source":"featured"}')}`))).json()
    expect(j).toEqual({ kind: 'products', items: [{ id: 'p1', name: 'Shirt', image_url: 't.jpg', price: 499 }] })
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual([8])
  })

  it('ignores a malformed config', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    expect((await GET(req('?type=product_row&config=%7Bnope'))).status).toBe(200)
  })

  it('draws motion hero and stories straight from config, with a note when empty', async () => {
    vi.mocked(motionHeroSlides).mockReturnValue([{ headline: 'Big', bgImage: 'b.jpg' }] as any)
    expect(await (await GET(req('?type=motion_hero'))).json()).toEqual({ kind: 'hero', items: [{ id: '0', name: 'Big', image_url: 'b.jpg' }] })
    vi.mocked(storyGroups).mockReturnValue([])
    const s = await (await GET(req('?type=stories'))).json()
    expect(s.items).toEqual([])
    expect(s.note).toContain('Add a story')
  })

  it('keeps only safe link tiles', async () => {
    const cfg = encodeURIComponent(JSON.stringify({ items: [{ url: 'https://a', title: 'One', imageUrl: 'https://i' }, { url: 'javascript:x', title: 'Bad' }, { url: 'https://b' }] }))
    const j = await (await GET(req(`?type=blog_teaser&config=${cfg}`))).json()
    expect(j.items).toEqual([
      { id: 'item-0', name: 'One', image_url: 'https://i' },
      { id: 'item-1', name: 'Article', image_url: null },
    ])
  })

  it('asks for a product when the spotlight has none', async () => {
    const j = await (await GET(req('?type=product_spotlight'))).json()
    expect(j.note).toContain('Pick a product')
  })

  it('500s when a resolver throws', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req('?type=product_row'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Preview failed' })
  })
})
