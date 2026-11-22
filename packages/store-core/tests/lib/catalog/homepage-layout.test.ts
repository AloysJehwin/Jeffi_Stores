import { describe, it, expect, vi, beforeEach } from 'vitest'

const redis = { get: vi.fn(), set: vi.fn(), del: vi.fn() }
vi.mock('@/lib/shared/redis', () => ({ getRedisClient: vi.fn(() => redis) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: vi.fn() }))
vi.mock('@/lib/catalog/homepage-model', () => ({ resolvePageSections: vi.fn() }))
const headersGet = vi.fn()
vi.mock('next/headers', () => ({ headers: async () => ({ get: headersGet }) }))

import {
  layoutOf,
  defaultLayout,
  getPageLayout,
  getLayoutSections,
  invalidateHomepageLayoutCache,
  _resetHomepageLayoutMemo,
} from '@/lib/catalog/homepage-layout'
import { getRedisClient as _getRedisClient } from '@/lib/shared/redis'
import { getCurrentTenant as _getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { resolvePageSections as _resolvePageSections } from '@/lib/catalog/homepage-model'
import type { HomepageSection } from '@/lib/catalog/homepage-sections'

const getRedisClient = vi.mocked(_getRedisClient)
const getCurrentTenant = vi.mocked(_getCurrentTenant)
const resolvePageSections = vi.mocked(_resolvePageSections)

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

beforeEach(() => {
  _resetHomepageLayoutMemo()
  redis.get.mockReset()
  redis.set.mockReset().mockResolvedValue('OK')
  redis.del.mockReset().mockResolvedValue(1)
  getRedisClient.mockClear()
  getCurrentTenant.mockReset()
  resolvePageSections.mockReset()
  headersGet.mockReset()
})

describe('layoutOf', () => {
  it('maps sections to {type, side} on the homepage (no after)', () => {
    const out = layoutOf([section({ type: 'hero' }), section({ id: 's2', type: 'about' })], 'home')
    expect(out).toEqual([
      { type: 'hero', side: 'full' },
      { type: 'about', side: 'full' },
    ])
  })

  it('includes a placement "after" on listing pages and reads the side from config', () => {
    const left = section({ type: 'product_row', config: { layout: { side: 'left' }, placement: { after: 6 } } })
    const out = layoutOf([left], 'products')
    expect(out[0].type).toBe('product_row')
    expect(out[0].side).toBe('left')
    expect(out[0].after).toBe(6)
  })
})

describe('defaultLayout', () => {
  it('returns the default home layout for the homepage', () => {
    const out = defaultLayout('home')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].type).toBe('hero')
  })

  it('returns an empty layout for listing pages', () => {
    expect(defaultLayout('products')).toEqual([])
  })
})

describe('getPageLayout', () => {
  it('returns the fallback default immediately on a miss, filling caches in the background', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    redis.get.mockResolvedValue(null)
    resolvePageSections.mockResolvedValue({ audience: 'store', sections: [section({ type: 'hero' })] })
    const layout = await getPageLayout('home', 'store')
    expect(layout.audience).toBe('store')
    // Fallback uses the default home layout across all surfaces.
    expect(layout.surfaces.web[0].type).toBe('hero')
    expect(layout.surfaces.web_mobile).toEqual(layout.surfaces.web)
  })

  it('waits for and returns the computed layout with opts.wait', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    redis.get.mockResolvedValue(null)
    resolvePageSections.mockResolvedValue({ audience: 'store', sections: [section({ type: 'about' })] })
    const layout = await getPageLayout('home', 'store', { wait: true })
    expect(layout.surfaces.web[0].type).toBe('about')
    // One compute per surface (web, web_mobile, app).
    expect(resolvePageSections).toHaveBeenCalledTimes(3)
    // The computed layout was written to Redis.
    expect(redis.set).toHaveBeenCalled()
  })

  it('returns a parsed Redis hit without computing', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    const cached = { audience: 'store', surfaces: { web: [{ type: 'hero', side: 'full' }], web_mobile: [], app: [] } }
    redis.get.mockResolvedValue(JSON.stringify(cached))
    const layout = await getPageLayout('home', 'store')
    expect(layout).toEqual(cached)
    expect(resolvePageSections).not.toHaveBeenCalled()
  })

  it('serves the second call from the in-process memo', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    const cached = { audience: 'store', surfaces: { web: [{ type: 'hero', side: 'full' }], web_mobile: [], app: [] } }
    redis.get.mockResolvedValue(JSON.stringify(cached))
    await getPageLayout('home', 'store')
    redis.get.mockClear()
    const again = await getPageLayout('home', 'store')
    expect(again).toEqual(cached)
    expect(redis.get).not.toHaveBeenCalled()
  })

  it('ignores an unparseable Redis entry and falls back', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    redis.get.mockResolvedValue('{not json')
    resolvePageSections.mockResolvedValue({ audience: 'store', sections: [] })
    const layout = await getPageLayout('home', 'store')
    expect(layout.audience).toBe('store')
  })

  it('ignores a Redis entry of the wrong shape', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    redis.get.mockResolvedValue(JSON.stringify({ surfaces: { web: 'nope' } }))
    resolvePageSections.mockResolvedValue({ audience: 'store', sections: [] })
    const layout = await getPageLayout('home', 'store')
    // Fell through to compute/fallback rather than returning the bad entry.
    expect(layout.surfaces.web).toBeInstanceOf(Array)
  })

  it('falls back when compute rejects (wait path)', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    redis.get.mockResolvedValue(null)
    resolvePageSections.mockRejectedValue(new Error('compute boom'))
    const layout = await getPageLayout('home', 'store', { wait: true })
    // Fallback default home layout.
    expect(layout.surfaces.web[0].type).toBe('hero')
  })

  it('uses the tenant slug header when there is no current tenant', async () => {
    getCurrentTenant.mockReturnValue(null)
    headersGet.mockReturnValue('acme')
    redis.get.mockResolvedValue(null)
    resolvePageSections.mockResolvedValue({ audience: 'store', sections: [] })
    await getPageLayout('home', 'store', { wait: true })
    expect(redis.set.mock.calls[0][0]).toContain('slug:acme')
  })

  it('uses the platform key when no tenant and no slug header', async () => {
    getCurrentTenant.mockReturnValue(null)
    headersGet.mockReturnValue(null)
    redis.get.mockResolvedValue(null)
    resolvePageSections.mockResolvedValue({ audience: 'store', sections: [] })
    await getPageLayout('home', 'store', { wait: true })
    expect(redis.set.mock.calls[0][0]).toContain(':platform:')
  })
})

describe('getLayoutSections', () => {
  it('returns the surface layout for a store page', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    const cached = { audience: 'store', surfaces: { web: [{ type: 'hero', side: 'full' }], web_mobile: [{ type: 'about', side: 'full' }], app: [] } }
    redis.get.mockResolvedValue(JSON.stringify(cached))
    const sections = await getLayoutSections('home', 'store', 'web_mobile')
    expect(sections).toEqual([{ type: 'about', side: 'full' }])
  })

  it('falls back to web when the surface is missing', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    const cached = { audience: 'store', surfaces: { web: [{ type: 'hero', side: 'full' }] } }
    redis.get.mockResolvedValue(JSON.stringify(cached))
    const sections = await getLayoutSections('home', 'store', 'app')
    expect(sections).toEqual([{ type: 'hero', side: 'full' }])
  })

  it('returns null for a business request whose layout is only the store audience', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    const cached = { audience: 'store', surfaces: { web: [{ type: 'hero', side: 'full' }], web_mobile: [], app: [] } }
    redis.get.mockResolvedValue(JSON.stringify(cached))
    expect(await getLayoutSections('home', 'business', 'web')).toBeNull()
  })

  it('returns the business layout when published as business', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    const cached = { audience: 'business', surfaces: { web: [{ type: 'business_account', side: 'full' }], web_mobile: [], app: [] } }
    redis.get.mockResolvedValue(JSON.stringify(cached))
    const sections = await getLayoutSections('home', 'business', 'web')
    expect(sections).toEqual([{ type: 'business_account', side: 'full' }])
  })
})

describe('invalidateHomepageLayoutCache', () => {
  it('deletes every page/audience Redis entry for the tenant', async () => {
    getCurrentTenant.mockReturnValue({ tenantId: 't1' } as any)
    await invalidateHomepageLayoutCache()
    // 4 pages x 2 audiences = 8 deletes.
    expect(redis.del).toHaveBeenCalledTimes(8)
    expect(redis.del.mock.calls.every(c => String(c[0]).includes(':t1:'))).toBe(true)
  })
})
