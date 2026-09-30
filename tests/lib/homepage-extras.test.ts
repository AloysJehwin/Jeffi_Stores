import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/catalog/product-cards', () => ({ getProductCards: vi.fn(), getProductCardsByIds: vi.fn() }))

import { queryMany, queryOne } from '@/lib/shared/db'
import { getProductCards, getProductCardsByIds } from '@/lib/catalog/product-cards'
import {
  getBackInStock,
  getBundles,
  getCategoryTabs,
  getCountdownDeal,
  getTestimonials,
  getValueStats,
  loadSectionExtras,
} from '@/lib/catalog/homepage-extras'
import type { HomepageSection, SectionType } from '@/lib/catalog/homepage-sections'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const s = (type: SectionType, config: Record<string, unknown> = {}, id = 'sec') =>
  ({
    id,
    type,
    config,
    title: null,
    subtitle: null,
    eyebrow: null,
    cta_label: null,
    cta_url: null,
    display_order: 0,
    is_active: true,
    starts_at: null,
    ends_at: null,
  }) as HomepageSection

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getProductCards).mockResolvedValue([])
  vi.mocked(getProductCardsByIds).mockResolvedValue([])
})

describe('getCountdownDeal', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')

  it('needs a picked product', async () => {
    expect(await getCountdownDeal(s('countdown_deal'), true, now)).toBeNull()
    expect(getProductCardsByIds).not.toHaveBeenCalled()
  })

  it('hides once the countdown has ended', async () => {
    expect(
      await getCountdownDeal(s('countdown_deal', { productId: A, endsAt: '2026-09-24T00:00:00Z' }), true, now)
    ).toBeNull()
    expect(getProductCardsByIds).not.toHaveBeenCalled()
  })

  it('returns the live product with its end time', async () => {
    vi.mocked(getProductCardsByIds).mockResolvedValue([{ id: A, name: 'Drill' }])
    expect(
      await getCountdownDeal(s('countdown_deal', { productId: A, endsAt: '2026-10-01T00:00:00Z' }), true, now)
    ).toEqual({ product: { id: A, name: 'Drill' }, endsAt: '2026-10-01T00:00:00Z' })
  })
})

describe('getTestimonials', () => {
  it('passes rating and limit, and shortens reviewer names', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      {
        id: 'r1',
        rating: 5,
        title: ' Great ',
        comment: ' Works well ',
        is_verified_purchase: true,
        product_name: 'Drill',
        product_slug: 'drill',
        first_name: 'Aloys',
        last_name: 'jehwin',
      },
      {
        id: 'r2',
        rating: 4,
        title: null,
        comment: 'Solid',
        is_verified_purchase: false,
        product_name: 'Saw',
        product_slug: 'saw',
        first_name: null,
        last_name: null,
      },
    ])
    const out = await getTestimonials(s('testimonials', { minRating: 5, limit: 3 }))
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('r.is_approved = true')
    expect(params).toEqual([5, 3])
    expect(out.map(t => [t.author, t.title, t.comment, t.verified])).toEqual([
      ['Aloys J.', 'Great', 'Works well', true],
      ['A customer', null, 'Solid', false],
    ])
  })
})

describe('getCategoryTabs', () => {
  it('keeps the picked order and drops categories with no products', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: B, name: 'Tools', slug: 'tools' },
      { id: A, name: 'Fasteners', slug: 'fasteners' },
    ])
    vi.mocked(getProductCards).mockImplementation(async ({ params }) => (params?.[0] === A ? [{ id: 'p1' }] : []))
    const tabs = await getCategoryTabs(s('category_tabs', { categoryIds: [A, B] }), false)
    expect(tabs.map(t => t.id)).toEqual([A])
    expect(vi.mocked(getProductCards).mock.calls.map(c => c[0].params?.[0])).toEqual([A, B])
  })

  it('falls back to the busiest top-level categories, capped at the tab count', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    await getCategoryTabs(s('category_tabs', { tabs: 3 }), false)
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('parent_category_id IS NULL')
    expect(params).toEqual([3])
  })
})

describe('getBundles', () => {
  it('uses picked products when set, else every live bundle', async () => {
    vi.mocked(getProductCardsByIds).mockResolvedValue([{ id: A }, { id: B }])
    expect(await getBundles(s('bundle_spotlight', { productIds: [A, B], limit: 1 }), true)).toEqual([{ id: A }])
    await getBundles(s('bundle_spotlight'), true)
    expect(vi.mocked(getProductCards).mock.calls[0][0].where).toContain('p.is_bundle = true')
  })
})

describe('getBackInStock', () => {
  it('requires a restock from empty inside the window and stock now', async () => {
    await getBackInStock(s('back_in_stock', { days: 7 }), true)
    const opts = vi.mocked(getProductCards).mock.calls[0][0]
    expect(opts.where).toContain('FROM inventory_transactions t')
    expect(opts.where).toContain('FROM shelf_stock_transactions s')
    expect(opts.where).toContain('t.quantity_after - t.quantity_change <= 0')
    expect(opts.where).toContain('s.quantity_after - s.quantity_change <= 0')
    expect(opts.where).toContain('FROM admin_audit_log a')
    expect(opts.where).toContain("a.diff->'stock_status'->>'from' = 'Out of Stock'")
    expect(opts.where).toContain("'product_variants', 'product_sub_variants'")
    expect(opts.orderBy).toContain('t.product_id = p.id')
    expect(opts.orderBy).toContain("ELSE a.metadata->>'product_id' END = p.id::text")
    expect(opts.where).toContain("p.stock_status IS DISTINCT FROM 'Out of Stock'")
    expect(opts.params).toEqual([7])
    expect(opts.orderBy).toContain('back_in_stock_notify')
  })
})

describe('getValueStats', () => {
  it('leaves out metrics that are still zero', async () => {
    vi.mocked(queryOne).mockResolvedValue({ orders_shipped: '213', products: '1202', cities: '0', customers: '47' })
    expect(await getValueStats(s('value_stats'))).toEqual([
      { metric: 'orders_shipped', label: 'Orders shipped', value: 213 },
      { metric: 'products', label: 'Products to choose from', value: 1202 },
    ])
  })

  it('skips the query when nothing is picked', async () => {
    expect(await getValueStats(s('value_stats', { metrics: [] }))).toEqual([])
    expect(queryOne).not.toHaveBeenCalled()
  })
})

describe('loadSectionExtras', () => {
  it('loads only data-backed types and skips a failing section', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    vi.mocked(queryOne).mockResolvedValue({ orders_shipped: '5', products: '5', cities: '5', customers: '5' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const extras = await loadSectionExtras(
      [s('hero', {}, 'h'), s('testimonials', {}, 't'), s('value_stats', {}, 'v'), s('social_strip', {}, 'so')],
      true
    )
    expect([...extras.keys()]).toEqual(['v'])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
