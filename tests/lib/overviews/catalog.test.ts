import { describe, it, expect } from 'vitest'
import { margin, priceChange, resolveListTab } from '@/lib/overviews/catalog'
import { healthCounts, productAttention } from '@/lib/overviews/products'
import { classifyGroups, groupAttention, toGroupRow, type GroupRow } from '@/lib/overviews/categories'
import { offerAttention, offerCounts, toOfferRow } from '@/lib/overviews/offers'
import { approvalRate, enrichmentAttention, enrichmentState } from '@/lib/overviews/catalog-enrichment'
import { daysSince, inflationAttention, runStats } from '@/lib/overviews/inflation'

const NOW = new Date('2026-10-16T06:00:00Z')

describe('catalog helpers', () => {
  it('opens the list for old URLs and the overview otherwise', () => {
    expect(resolveListTab({})).toBe('overview')
    expect(resolveListTab({ from: '2026-10-01', to: '2026-10-10' })).toBe('overview')
    expect(resolveListTab({ search: 'bolt' })).toBe('list')
    expect(resolveListTab({ page: '2' })).toBe('list')
    expect(resolveListTab({ search: '' })).toBe('overview')
    expect(resolveListTab({ tab: 'overview', search: 'x' })).toBe('overview')
    expect(resolveListTab({ tab: 'list' })).toBe('list')
  })

  it('computes margin and price change only with real bases', () => {
    expect(margin(100, 60)).toBeCloseTo(0.4)
    expect(margin(100, 0)).toBeNull()
    expect(margin(0, 10)).toBeNull()
    expect(priceChange('100', '110')).toBeCloseTo(0.1)
    expect(priceChange(0, 110)).toBeNull()
    expect(priceChange(100, null)).toBeNull()
  })
})

describe('products attention', () => {
  it('orders by severity and skips clean issues', () => {
    const h = healthCounts({ active: '10', no_price: '1', no_hsn: '2', no_gst: '0', no_cost: '8', no_image: '0', out_of_stock: '0' })
    const a = productAttention(h, [{ id: '1', name: 'Pump' }], 3)
    expect(a.map(x => x.key)).toEqual(['sellers_out', 'no_price', 'no_tax', 'no_cost', 'never_sold'])
    expect(a[0].severity).toBe('critical')
    expect(a.find(x => x.key === 'no_cost')!.severity).toBe('warning')
    expect(productAttention(healthCounts({ active: 5 }), [], 0)).toEqual([])
  })
})

const g = (o: Partial<GroupRow>): GroupRow => ({
  ...toGroupRow({ id: 'x', name: 'X', is_active: true }),
  ...o,
})

describe('group classification', () => {
  it('finds empty, unused and inactive groups', () => {
    const rows = [
      g({ id: 'a', name: 'Empty', products: 0 }),
      g({ id: 'b', name: 'Parent', products: 0, hasChildren: true }),
      g({ id: 'c', name: 'Stale', products: 3, activeProducts: 3, lastSale: '2026-01-01T00:00:00Z', stockValue: 50 }),
      g({ id: 'd', name: 'Fresh', products: 2, activeProducts: 2, lastSale: '2026-10-10T00:00:00Z', sales: 100 }),
      g({ id: 'e', name: 'Off', isActive: false, products: 1, activeProducts: 1 }),
    ]
    const c = classifyGroups(rows, NOW)
    expect(c.empty.map(r => r.id)).toEqual(['a'])
    expect(c.unused.map(r => r.id)).toEqual(['c'])
    expect(c.inactiveWithProducts.map(r => r.id)).toEqual(['e'])
    expect(c.totals).toMatchObject({ groups: 5, active: 4, products: 6, sales: 100 })
    const a = groupAttention('category', c, rows, 2)
    expect(a.map(x => x.key)).toEqual(['inactive_with_products', 'unassigned', 'empty', 'unused'])
    expect(a[2].title).toBe('1 active category with no products')
  })

  it('maps rows from SQL', () => {
    const r = toGroupRow({ id: 'a', name: 'Bolts', is_active: true, sales: '120', costed_net: '100', cost: '70', last_sale: new Date('2026-10-01T00:00:00Z') })
    expect(r).toMatchObject({ sales: 120, margin: 0.3, lastSale: '2026-10-01T00:00:00.000Z' })
  })
})

describe('offers', () => {
  const rows = [
    toOfferRow({ id: '1', title: 'Diwali', status: 'live', ends_at: '2026-10-20T00:00:00Z', products: '0' }),
    toOfferRow({ id: '2', title: 'Winter', status: 'scheduled', starts_at: '2026-10-18T00:00:00Z', products: '4', no_image: true }),
    toOfferRow({ id: '3', title: 'Old', status: 'ended', products: '2' }),
  ]
  it('counts live, expiring and starting offers', () => {
    const c = offerCounts(rows, NOW)
    expect(c).toMatchObject({ live: 1, scheduled: 1, ended: 1, productsOnOffer: 0 })
    expect(c.expiring.map(r => r.id)).toEqual(['1'])
    expect(c.startingSoon.map(r => r.id)).toEqual(['2'])
  })
  it('flags empty, expiring and imageless offers', () => {
    expect(offerAttention(rows, NOW).map(a => a.key)).toEqual(['live_empty', 'expiring', 'no_image', 'starting'])
  })
})

describe('catalogue enrichment', () => {
  it('averages filled fields over active products', () => {
    const s = enrichmentState({ active: '10', enriched: '8', pending: '3', pending_stale: '1', ai_description: '10', ai_keywords: '6' })
    expect(s.fieldsFilled).toBeCloseTo(16 / 80)
    expect(approvalRate(3, 1)).toBe(0.75)
    expect(approvalRate(0, 0)).toBeNull()
    expect(enrichmentAttention(s, 2).map(a => a.key)).toEqual(['stale', 'failed', 'not_enriched'])
  })
})

describe('bulk price', () => {
  it('weights the average change by products', () => {
    expect(runStats({ runs: '2', products: '30', weighted: '150' }).avgChange).toBe(5)
    expect(runStats({}).avgChange).toBeNull()
  })
  it('flags stale runs and rollbacks', () => {
    expect(daysSince('2026-10-06T06:00:00Z', NOW)).toBe(10)
    expect(inflationAttention(null, [{ name: 'Bolts', products: 4 }], 0, NOW).map(a => a.key)).toEqual(['never'])
    expect(inflationAttention('2026-01-01T00:00:00Z', [{ name: 'Bolts', products: 4 }], 1, NOW).map(a => a.key)).toEqual([
      'stale_run',
      'stale_categories',
      'rollbacks',
    ])
  })
})
