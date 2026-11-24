import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ status: vi.fn(), tenantKey: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/customer-links', () => ({ catalogBaseUrl: vi.fn() }))
vi.mock('@/lib/merchant/custom-labels', () => ({ itemLabels: vi.fn(), MARGIN_LABELS: [], STOCK_LABELS: [], VELOCITY_LABELS: [] }))
vi.mock('@/lib/merchant/sales-velocity', () => ({ loadSalesVelocity: vi.fn() }))
vi.mock('@/lib/google-ads/assets', () => ({ freeDeliveryCallout: vi.fn() }))
vi.mock('@/lib/google-ads/geo', () => ({ shipToStates: vi.fn(), INDIA_REGION_COUNT: 36 }))
vi.mock('@/lib/google-ads/connection', () => ({ getAdsConnectionStatus: h.status }))
vi.mock('@/lib/google-ads/credentials', () => ({ adsTenantKey: h.tenantKey }))

import { CampaignSpecSchema, INDIA, specProblems } from '@/lib/google-ads/campaign-spec'
import { LIMITS, adTextLength } from '@/lib/google-ads/limits'
import { ECOM_PRESET_IDS, buildEcomPresets, ecomOrigin, ecomPresetsAvailable, presetSpec, utmUrl } from '@/lib/google-ads/ecom-presets'
import { loadEcomPresets } from '@/lib/google-ads/manage-data'

const ORIGIN = 'https://ecom.jeffistores.in'

describe('ecom presets', () => {
  const presets = buildEcomPresets(ORIGIN, 'Jeffi Stores')

  it('offers the store and Showcase presets', () => {
    expect(presets.map(p => p.id)).toEqual([...ECOM_PRESET_IDS])
    expect(presets.map(p => p.label)).toEqual(['Online store for your business', 'Free business website (Showcase)'])
  })

  it.each(presets.map(p => [p.id, p] as const))('%s stays within Google limits', (_id, p) => {
    for (const hl of p.headlines) expect(adTextLength(hl)).toBeLessThanOrEqual(LIMITS.headline)
    for (const d of p.descriptions) expect(adTextLength(d)).toBeLessThanOrEqual(LIMITS.description)
    expect(adTextLength(p.path1)).toBeLessThanOrEqual(LIMITS.path)
    expect(adTextLength(p.path2)).toBeLessThanOrEqual(LIMITS.path)
    expect(p.headlines.length).toBeGreaterThanOrEqual(3)
    expect(p.descriptions.length).toBeGreaterThanOrEqual(2)
    expect(new Set(p.headlines.map(x => x.toLowerCase())).size).toBe(p.headlines.length)
  })

  it.each(presets.map(p => [p.id, p] as const))('%s builds a valid paused Search spec for India in English and Hindi', (_id, p) => {
    const spec = presetSpec(p)
    expect(CampaignSpecSchema.safeParse(spec).success).toBe(true)
    expect(specProblems(spec, '2026-01-01')).toEqual([])
    expect(spec.type).toBe('SEARCH')
    expect(spec.status).toBe('PAUSED')
    expect(spec.locations).toEqual([INDIA])
    expect(spec.languages).toEqual(['languageConstants/1000', 'languageConstants/1023'])
    expect(spec.dailyBudget).toBeGreaterThan(0)
    const kw = spec.adGroups![0].keywords
    expect(kw.some(k => k.matchType === 'EXACT')).toBe(true)
    expect(kw.some(k => k.matchType === 'PHRASE')).toBe(true)
    expect(spec.adGroups![0].negatives!.length).toBeGreaterThan(5)
  })

  it('points at the ecom site with UTM tags', () => {
    const [store, showcase] = presets
    const s = new URL(store.finalUrl)
    expect(s.origin).toBe(ORIGIN)
    expect(s.pathname).toBe('/')
    expect(Object.fromEntries(s.searchParams)).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ecom_store' })
    const w = new URL(showcase.finalUrl)
    expect(w.origin).toBe(ORIGIN)
    expect(w.pathname).toBe('/pricing')
    expect(w.searchParams.get('utm_campaign')).toBe('ecom_showcase')
  })

  it('utmUrl keeps the path and tolerates a trailing slash on the origin', () => {
    expect(utmUrl(`${ORIGIN}/`, '/pricing', 'x')).toBe(`${ORIGIN}/pricing?utm_source=google&utm_medium=cpc&utm_campaign=x`)
  })

  it('takes the ecom origin from config, not a hardcoded host', () => {
    expect(ecomOrigin({})).toBe('https://ecom.jeffistores.in')
    expect(ecomOrigin({ PLATFORM_ROOT_DOMAIN: 'example.test' })).toBe('https://ecom.example.test')
    expect(ecomOrigin({ NEXT_PUBLIC_ECOM_URL: 'http://ecom.localhost:3000/' })).toBe('http://ecom.localhost:3000')
  })
})

describe('flagship / platform-only gating', () => {
  beforeEach(() => {
    h.status.mockReset()
    h.tenantKey.mockReset().mockResolvedValue('platform')
  })

  it('is available only on the flagship connected in platform mode', () => {
    expect(ecomPresetsAvailable({ flagship: true, connectedVia: 'platform' })).toBe(true)
    expect(ecomPresetsAvailable({ flagship: true, connectedVia: 'oauth' })).toBe(false)
    expect(ecomPresetsAvailable({ flagship: true, connectedVia: 'manager' })).toBe(false)
    expect(ecomPresetsAvailable({ flagship: false, connectedVia: 'platform' })).toBe(false)
    expect(ecomPresetsAvailable({ flagship: true, connectedVia: null })).toBe(false)
    expect(ecomPresetsAvailable(null)).toBe(false)
  })

  it('the wizard bootstrap gets presets on the platform-connected flagship', async () => {
    h.status.mockResolvedValue({ flagship: true, connectedVia: 'platform' })
    const list = await loadEcomPresets()
    expect(list?.map(p => p.id)).toEqual([...ECOM_PRESET_IDS])
  })

  it.each([
    ['a store', { flagship: false, connectedVia: 'oauth' }],
    ['a store in platform-looking mode', { flagship: false, connectedVia: 'platform' }],
    ['the flagship signed in with Google', { flagship: true, connectedVia: 'oauth' }],
  ])('gets no presets for %s', async (_n, status) => {
    h.status.mockResolvedValue(status)
    expect(await loadEcomPresets()).toBeUndefined()
  })

  it('gets none when the connection cannot be read', async () => {
    h.status.mockRejectedValue(new Error('db down'))
    expect(await loadEcomPresets()).toBeUndefined()
  })
})
