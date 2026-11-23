import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/catalog/hero-slides', () => ({ heroSlideHref: vi.fn(() => '/hero') }))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_INCL_GST_SQL: 'incl',
  VARIANT_MIN_PRICE_EX_GST_SQL: 'excl',
  VARIANT_MIN_MRP_SQL: 'mrp',
  VARIANT_STOCK_TOTAL_SQL: 'stock',
}))
vi.mock('@/lib/tenancy/get-host', () => ({ getHost: vi.fn(async () => 'shop.example.com') }))
vi.mock('@/lib/payments/wallet', () => ({ isFlagshipTenant: vi.fn(() => false) }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getStorefrontContent: vi.fn(async () => ({ aboutCopy: '', statsJson: '' })),
  getFeatureFlags: vi.fn(async () => ({ gstEnabled: true, codEnabled: true })),
  getStoreIdentity: vi.fn(async () => ({ name: 'My Store' })),
}))
vi.mock('@/lib/catalog/homepage-data', () => ({
  AUDIENCE_COLUMN_SQL: () => 'aud',
  SURFACE_COLUMN_SQL: () => 'surf',
  getAudienceSections: vi.fn(),
  buildProductRowSql: vi.fn(() => 'SELECT rows'),
  planDataNeeds: vi.fn(() => ({})),
  planProductRows: vi.fn(() => new Map()),
}))
vi.mock('@/lib/catalog/homepage-extras', () => ({ loadSectionExtras: vi.fn(async () => new Map()) }))
vi.mock('@/lib/catalog/homepage-plan', () => ({
  getHomepagePlan: vi.fn(),
  planAllowsAudience: vi.fn(),
  planAllowsType: vi.fn(),
}))
vi.mock('@/lib/catalog/product-offers', () => ({ listActiveOffers: vi.fn(async () => []), listOffersByIds: vi.fn(async () => []) }))
vi.mock('@/lib/catalog/product-card-props', () => ({
  cardPropsFor: vi.fn((...args: any[]) => (args[0] as any[]).map((r: { id?: string }) => ({ id: r?.id ?? 'c', _card: true }))),
}))
vi.mock('@/lib/catalog/public-product', () => ({ publicProducts: vi.fn((rows: unknown[]) => rows) }))
vi.mock('@/lib/site/store', () => ({ siteLayoutState: vi.fn(async () => null) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => 't1') }))
vi.mock('@/lib/tenancy/forms-host', () => ({ businessHostForHost: vi.fn(() => 'acme.business.example.com') }))
vi.mock('@/lib/shipping/delivery-settings', () => ({ getDeliverySettings: vi.fn(async () => ({ freeThreshold: 999 })) }))

import {
  resolvePageSections,
  getPageSections,
  buildHomeModel,
  loadSectionData,
  toHomeModelJson,
  type HomeModel,
} from '@/lib/catalog/homepage-model'
import type { HomepageSection } from '@/lib/catalog/homepage-sections'
import { getAudienceSections as _gas, planDataNeeds as _pdn, planProductRows as _ppr } from '@/lib/catalog/homepage-data'
import { getHomepagePlan as _ghp, planAllowsAudience as _paa, planAllowsType as _pat } from '@/lib/catalog/homepage-plan'
import { loadSectionExtras as _lse } from '@/lib/catalog/homepage-extras'
import { queryMany as _queryMany } from '@/lib/shared/db'
import { cardPropsFor as _cardPropsFor } from '@/lib/catalog/product-card-props'
import { siteLayoutState as _siteLayoutState } from '@/lib/site/store'

const getAudienceSections = vi.mocked(_gas)
const planDataNeeds = vi.mocked(_pdn)
const planProductRows = vi.mocked(_ppr)
const getHomepagePlan = vi.mocked(_ghp)
const planAllowsAudience = vi.mocked(_paa)
const planAllowsType = vi.mocked(_pat)
const loadSectionExtras = vi.mocked(_lse)
const queryMany = vi.mocked(_queryMany)
const cardPropsFor = vi.mocked(_cardPropsFor)
const siteLayoutState = vi.mocked(_siteLayoutState)

const section = (over: Partial<HomepageSection> = {}): HomepageSection => ({
  id: over.id ?? 's1',
  type: over.type ?? 'hero',
  title: null,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: over.config ?? {},
  display_order: over.display_order ?? 0,
  is_active: true,
  starts_at: null,
  ends_at: null,
  ...over,
})

const PLAN = { types: [], business: true, upgrade: {}, businessUpgrade: null }

beforeEach(() => {
  vi.clearAllMocks()
  getHomepagePlan.mockResolvedValue(PLAN as never)
  planAllowsAudience.mockReturnValue(true)
  planAllowsType.mockReturnValue(true)
  siteLayoutState.mockResolvedValue(null)
  planDataNeeds.mockReturnValue({} as never)
  planProductRows.mockReturnValue(new Map())
  loadSectionExtras.mockResolvedValue(new Map())
  queryMany.mockResolvedValue([])
})

describe('resolvePageSections / getPageSections', () => {
  it('returns the served audience and sections filtered by plan', async () => {
    getAudienceSections.mockResolvedValue({
      audience: 'store',
      sections: [section({ id: 'a', type: 'hero' }), section({ id: 'b', type: 'about' })],
    } as never)
    planAllowsType.mockImplementation((_p, t) => t !== 'about')
    const out = await resolvePageSections({ surface: 'web', page: 'home', audience: 'store' })
    expect(out.audience).toBe('store')
    expect(out.sections.map(s => s.id)).toEqual(['a'])
  })

  it('downgrades a business request to store when the plan forbids it', async () => {
    planAllowsAudience.mockReturnValue(false)
    getAudienceSections.mockResolvedValue({ audience: 'store', sections: [] } as never)
    await resolvePageSections({ audience: 'business' })
    // getAudienceSections asked for store, not business.
    expect(getAudienceSections.mock.calls[0][2]).toBe('store')
  })

  it('hides legacy-app-hidden types for a legacy client', async () => {
    getAudienceSections.mockResolvedValue({
      audience: 'store',
      sections: [section({ id: 'h', type: 'hero' }), section({ id: 'm', type: 'motion_hero' })],
    } as never)
    const out = await resolvePageSections({ legacyClient: true })
    expect(out.sections.map(s => s.id)).toEqual(['h'])
  })

  it('getPageSections unwraps the sections array', async () => {
    getAudienceSections.mockResolvedValue({ audience: 'store', sections: [section({ id: 'x' })] } as never)
    const out = await getPageSections()
    expect(out.map(s => s.id)).toEqual(['x'])
  })

  it('uses the published site documents as the draft when Site Builder is on', async () => {
    siteLayoutState.mockResolvedValue({ sections: [section({ id: 'site', type: 'hero' })], heroSlides: [] } as never)
    getAudienceSections.mockResolvedValue({ audience: 'store', sections: [section({ id: 'site' })] } as never)
    await resolvePageSections({ surface: 'web' })
    // draft (4th arg) came from the site state.
    expect(getAudienceSections.mock.calls[0][3]).toEqual([section({ id: 'site', type: 'hero' })])
  })
})

describe('loadSectionData', () => {
  it('skips every fetch when no section needs data', async () => {
    const data = await loadSectionData([section({ type: 'hero' })], { surface: 'web', page: 'home' })
    expect(data.heroSlides).toEqual([])
    expect(data.mainCategories).toEqual([])
    expect(data.gstEnabled).toBe(true)
    expect(data.codEnabled).toBe(true)
    expect(data.storeName).toBe('My Store')
    // Non-local host -> business url points at the business host.
    expect(data.businessLandingUrl).toContain('acme.business.example.com')
  })

  it('loads the data each needed source requires and builds product rows', async () => {
    planDataNeeds.mockReturnValue({
      mainCategories: true,
      heroSlides: true,
      offerSlider: true,
      categoryShowcase: true,
      topBrands: true,
      dealOfTheDay: true,
      freeShippingThreshold: true,
    } as never)
    planProductRows.mockReturnValue(new Map([['featured:8:', { source: 'featured', limit: 8, categorySlug: null }]]) as never)
    // queryMany is used for categories, hero slides, brands, deal, showcase, product rows.
    queryMany.mockResolvedValue([{ id: 'p1' }])
    const rowSection = section({ id: 'row', type: 'product_row', config: { source: 'featured' } })
    const data = await loadSectionData([rowSection], { surface: 'web', page: 'home' })
    expect(data.freeShippingThreshold).toBe(999)
    expect(data.productRows.has('row')).toBe(true)
  })

  it('treats a localhost host as local and uses relative business urls', async () => {
    const { getHost } = await import('@/lib/tenancy/get-host')
    vi.mocked(getHost).mockResolvedValue('localhost:3000')
    const data = await loadSectionData([section({ type: 'hero' })])
    expect(data.businessLandingUrl).toBe('/business')
    expect(data.businessSignupUrl).toBe('/business/signup')
  })
})

describe('buildHomeModel', () => {
  it('assembles audience, sections and data', async () => {
    getAudienceSections.mockResolvedValue({ audience: 'store', sections: [section({ id: 'a', type: 'hero' })] } as never)
    const model = await buildHomeModel({ surface: 'web' })
    expect(model.audience).toBe('store')
    expect(model.sections.map(s => s.id)).toEqual(['a'])
    expect(model.data).toBeDefined()
  })
})

describe('toHomeModelJson', () => {
  const baseData = () => ({
    heroSlides: [],
    offers: [],
    mainCategories: [],
    topBrands: [],
    categoryShowcase: [{ id: 'c', name: 'Cat', slug: 'cat', products: [{ id: 'cp' }] }],
    dealOfTheDay: [{ id: 'deal' }],
    productRows: new Map<string, unknown[]>(),
    freeShippingThreshold: 500,
    gstEnabled: true,
    codEnabled: true,
    flagshipCopy: false,
    stats: [{ value: '10+', label: 'Years' }],
    aboutCopy: 'Our story.',
    storeName: 'My Store',
    businessLandingUrl: '/business',
    businessSignupUrl: '/business/signup',
    extras: new Map<string, unknown>(),
  })

  it('maps product rows to cards and badges New when justLanded fires', () => {
    const rowSection = section({ id: 'row', type: 'product_row', config: { justLanded: true, newWithinDays: 30 } })
    const data = baseData()
    data.productRows.set('row', [{ id: 'p1', created_at: new Date().toISOString() }])
    const model: HomeModel = { audience: 'store', sections: [rowSection], data: data as never }
    const json = toHomeModelJson(model)
    expect(json.data.productRows.row[0].badge).toBe('New')
    expect(cardPropsFor).toHaveBeenCalled()
  })

  it('fills section copy defaults and validated items', () => {
    const aboutSection = section({ id: 'about', type: 'about' })
    const data = baseData()
    const model: HomeModel = { audience: 'store', sections: [aboutSection], data: data as never }
    const json = toHomeModelJson(model)
    const s = json.sections[0]
    expect(s.copy.title).toBeDefined()
    // about subtitle falls back to the aboutCopy.
    expect(s.copy.subtitle).toBe('Our story.')
    // about items default to the data stats.
    expect(s.items).toEqual(data.stats)
    expect(s.page).toBe('home')
  })

  it('transforms countdown_deal, bundle_spotlight and back_in_stock extras into cards', () => {
    const countdown = section({ id: 'cd', type: 'countdown_deal' })
    const bundle = section({ id: 'bs', type: 'bundle_spotlight' })
    const restock = section({ id: 'bis', type: 'back_in_stock' })
    const data = baseData()
    data.extras.set('cd', { endsAt: 'x', product: { id: 'pd' } })
    data.extras.set('bs', [{ id: 'b1', is_bundle: true }])
    data.extras.set('bis', [{ id: 'r1' }])
    const model: HomeModel = { audience: 'store', sections: [countdown, bundle, restock], data: data as never }
    const json = toHomeModelJson(model)
    expect((json.data.extras.cd as { product: unknown }).product).toBeDefined()
    expect((json.data.extras.bs as { badge: string }[])[0].badge).toBe('Bundle')
    expect((json.data.extras.bis as { badge: string }[])[0].badge).toBe('Back in stock')
  })

  it('nulls a countdown extra when there is no deal', () => {
    const countdown = section({ id: 'cd', type: 'countdown_deal' })
    const data = baseData()
    data.extras.set('cd', null)
    const model: HomeModel = { audience: 'store', sections: [countdown], data: data as never }
    expect(toHomeModelJson(model).data.extras.cd).toBeNull()
  })

  it('maps dealOfTheDay and categoryShowcase through cards', () => {
    const data = baseData()
    const model: HomeModel = { audience: 'store', sections: [], data: data as never }
    const json = toHomeModelJson(model)
    expect((json.data.dealOfTheDay[0] as any)._card).toBe(true)
    expect((json.data.categoryShowcase[0].products[0] as any)._card).toBe(true)
    expect(json.data.categoryShowcase[0].id).toBe('c')
  })

  it('emits validated config-only shapes for motion_hero, stories and rewards_game', () => {
    const motion = section({
      id: 'mh',
      type: 'motion_hero',
      config: { slides: [{ bgImage: '/a.jpg', headline: 'Hi' }], intervalSeconds: 5 },
    })
    const stories = section({ id: 'st', type: 'stories', config: { groups: [] } })
    const data = baseData()
    const model: HomeModel = { audience: 'store', sections: [motion, stories], data: data as never }
    const json = toHomeModelJson(model)
    expect((json.data.extras.mh as { slides: unknown[]; intervalMs: number }).slides.length).toBe(1)
    expect((json.data.extras.mh as { intervalMs: number }).intervalMs).toBe(5000)
    expect((json.data.extras.st as { groups: unknown[] }).groups).toEqual([])
  })
})
