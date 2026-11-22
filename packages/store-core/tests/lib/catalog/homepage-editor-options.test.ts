import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getStorefrontContent: vi.fn(), getStoreIdentity: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ isFlagshipTenant: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))

import { loadHeroData, loadSectionOptions } from '@/lib/catalog/homepage-editor-options'
import { queryMany as _queryMany, queryOne as _queryOne } from '@/lib/shared/db'
import { getStorefrontContent as _gsc, getStoreIdentity as _gsi } from '@/lib/catalog/site-controls'
import { isFlagshipTenant as _isFlagship } from '@/lib/payments/wallet'
import { resolveTenantId as _resolveTenantId } from '@/lib/tenancy/tenant-context'

const queryMany = vi.mocked(_queryMany)
const queryOne = vi.mocked(_queryOne)
const getStorefrontContent = vi.mocked(_gsc)
const getStoreIdentity = vi.mocked(_gsi)
const isFlagshipTenant = vi.mocked(_isFlagship)
const resolveTenantId = vi.mocked(_resolveTenantId)

beforeEach(() => {
  queryMany.mockReset()
  queryOne.mockReset()
  getStorefrontContent.mockReset()
  getStoreIdentity.mockReset()
  isFlagshipTenant.mockReset()
  resolveTenantId.mockReset()
})

describe('loadHeroData', () => {
  it('maps categories, brands, grades and materials into {value,label} options', async () => {
    queryMany
      .mockResolvedValueOnce([{ slug: 'tools', name: 'Tools' }])
      .mockResolvedValueOnce([{ id: 'b1', name: 'Bosch' }])
      .mockResolvedValueOnce([{ grade: 'A' }])
      .mockResolvedValueOnce([{ material: 'Steel' }])
    const data = await loadHeroData()
    expect(data.categoryOptions).toEqual([{ value: 'tools', label: 'Tools' }])
    expect(data.brandOptions).toEqual([{ value: 'b1', label: 'Bosch' }])
    expect(data.gradeOptions).toEqual([{ value: 'A', label: 'A' }])
    expect(data.materialOptions).toEqual([{ value: 'Steel', label: 'Steel' }])
    // Four parallel queries issued.
    expect(queryMany).toHaveBeenCalledTimes(4)
    expect(String(queryMany.mock.calls[0][0])).toContain('FROM categories')
    expect(String(queryMany.mock.calls[1][0])).toContain('FROM brands')
  })
})

describe('loadSectionOptions', () => {
  const cats = [{ value: 'c1', label: 'C1' }]
  const brands = [{ value: 'b1', label: 'B1' }]

  const setup = (flagship: boolean) => {
    getStorefrontContent.mockResolvedValue({ aboutCopy: '', statsJson: '' } as any)
    getStoreIdentity.mockResolvedValue({ name: 'My Store' } as any)
    resolveTenantId.mockResolvedValue('t1')
    isFlagshipTenant.mockReturnValue(flagship)
    queryOne.mockResolvedValue({
      featured: '3',
      new_arrivals: '10',
      best_sellers: '5',
      on_sale: '2',
      bundles: '1',
      approved_reviews: '7',
    })
    // topCategories queryMany
    queryMany.mockResolvedValue([{ id: 'tc1', name: 'Top Cat' }])
  }

  it('returns counts, top categories and tenant copy/tile defaults for a non-flagship', async () => {
    setup(false)
    const opts = await loadSectionOptions(cats, brands)
    expect(opts.categories).toBe(cats)
    expect(opts.brands).toBe(brands)
    expect(opts.topCategories).toEqual([{ value: 'tc1', label: 'Top Cat' }])
    expect(opts.counts).toEqual({
      featured: 3,
      newArrivals: 10,
      bestSellers: 5,
      onSale: 2,
      bundles: 1,
      approvedReviews: 7,
    })
    // Non-flagship gets neutral copy defaults for why_us, business_cta and about subtitle.
    expect(opts.copyDefaults?.why_us).toBeDefined()
    expect(opts.copyDefaults?.business_cta).toBeDefined()
    expect(opts.copyDefaults?.about?.subtitle).toContain('My Store')
    // Non-flagship tile defaults populated for trust_strip/why_us/benefits.
    expect(opts.tileDefaults?.trust_strip?.length).toBeGreaterThan(0)
    expect(opts.tileDefaults?.why_us?.length).toBeGreaterThan(0)
    expect(opts.tileDefaults?.benefits?.length).toBeGreaterThan(0)
    // Non-flagship about has no built-in figures.
    expect(opts.tileDefaults?.about).toEqual([])
  })

  it('omits tenant copy/tile defaults for the flagship', async () => {
    setup(true)
    const opts = await loadSectionOptions(cats, brands)
    // Flagship: why_us/business_cta copy defaults are not added (only about subtitle).
    expect(opts.copyDefaults?.why_us).toBeUndefined()
    expect(opts.copyDefaults?.business_cta).toBeUndefined()
    expect(opts.copyDefaults?.about?.subtitle).toBeDefined()
    // Flagship about stats use the built-in figures.
    expect(opts.tileDefaults?.about?.length).toBeGreaterThan(0)
    // Flagship does not add the neutral trust_strip/why_us/benefits tiles.
    expect(opts.tileDefaults?.trust_strip).toBeUndefined()
  })

  it('falls back to zero counts and empty top categories when those queries fail', async () => {
    getStorefrontContent.mockResolvedValue({ aboutCopy: 'We sell things.', statsJson: '' } as any)
    getStoreIdentity.mockResolvedValue({ name: 'S' } as any)
    resolveTenantId.mockResolvedValue(null)
    isFlagshipTenant.mockReturnValue(false)
    queryOne.mockRejectedValue(new Error('db down'))
    queryMany.mockRejectedValue(new Error('db down'))
    const opts = await loadSectionOptions(cats, brands)
    expect(opts.counts).toEqual({
      featured: 0,
      newArrivals: 0,
      bestSellers: 0,
      onSale: 0,
      bundles: 0,
      approvedReviews: 0,
    })
    expect(opts.topCategories).toEqual([])
    // about subtitle uses the store's own about copy.
    expect(opts.copyDefaults?.about?.subtitle).toBe('We sell things.')
  })

  it('tolerates resolveTenantId rejecting (treated as no tenant)', async () => {
    getStorefrontContent.mockResolvedValue({ aboutCopy: '', statsJson: '' } as any)
    getStoreIdentity.mockResolvedValue({ name: 'S' } as any)
    resolveTenantId.mockRejectedValue(new Error('no ctx'))
    isFlagshipTenant.mockReturnValue(false)
    queryOne.mockResolvedValue(null)
    queryMany.mockResolvedValue([])
    const opts = await loadSectionOptions(cats, brands)
    // counts default to 0 when queryOne returns null.
    expect(opts.counts.featured).toBe(0)
    expect(isFlagshipTenant).toHaveBeenCalledWith(null)
  })
})
