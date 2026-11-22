import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}))

import { buildProductFilterClauses, getFilterFacets } from '@/lib/catalog/product-filters'
import { queryMany, queryOne } from '@/lib/shared/db'

describe('buildProductFilterClauses', () => {
  it('returns nothing for empty params and keeps the start index', () => {
    const r = buildProductFilterClauses({}, 5)
    expect(r.conditions).toEqual([])
    expect(r.params).toEqual([])
    expect(r.nextIdx).toBe(5)
  })

  it('binds min/max price as numeric with advancing placeholders', () => {
    const r = buildProductFilterClauses({ minPrice: '10', maxPrice: '99' }, 1)
    expect(r.conditions[0]).toContain('>= $1::numeric')
    expect(r.conditions[1]).toContain('<= $2::numeric')
    expect(r.params).toEqual(['10', '99'])
    expect(r.nextIdx).toBe(3)
  })

  it('ignores empty-string price but not "0"', () => {
    expect(buildProductFilterClauses({ minPrice: '' }, 1).conditions).toEqual([])
    expect(buildProductFilterClauses({ minPrice: '0' }, 1).params).toEqual(['0'])
  })

  it('adds paramless in-stock and on-sale predicates only on "1"', () => {
    const r = buildProductFilterClauses({ inStock: '1', onSale: '1' }, 1)
    expect(r.conditions).toContain(`p.stock_status != 'Out of Stock'`)
    expect(r.conditions).toContain(`p.discount_pct > 0`)
    expect(r.params).toEqual([])
    expect(buildProductFilterClauses({ inStock: '0', onSale: '2' }, 1).conditions).toEqual([])
  })

  it('expands a comma brand list into an id/slug IN with duplicated placeholders', () => {
    const r = buildProductFilterClauses({ brand: 'nike, adidas' }, 1)
    expect(r.conditions[0]).toContain('id::text IN ($1, $2)')
    expect(r.conditions[0]).toContain('slug IN ($1, $2)')
    expect(r.params).toEqual(['nike', 'adidas'])
    expect(r.nextIdx).toBe(3)
  })

  it('skips a brand filter that trims to nothing', () => {
    expect(buildProductFilterClauses({ brand: ' , ' }, 1).conditions).toEqual([])
  })

  it('builds IN clauses for the attribute columns, skipping blanks', () => {
    const r = buildProductFilterClauses({ color: 'red,blue', grade: '', material: 'steel' }, 1)
    expect(r.conditions[0]).toBe('p.color IN ($1, $2)')
    expect(r.conditions[1]).toBe('p.material IN ($3)')
    expect(r.params).toEqual(['red', 'blue', 'steel'])
    expect(r.nextIdx).toBe(4)
  })

  it('adds a variant EXISTS clause only when both type and value are present', () => {
    expect(buildProductFilterClauses({ variantType: 'Color' }, 1).conditions).toEqual([])
    const r = buildProductFilterClauses({ variantType: 'Color', variantValue: 'Red' }, 3)
    expect(r.conditions[0]).toContain('pv.variant_type = $3 AND pv.variant_name = $4')
    expect(r.params).toEqual(['Color', 'Red'])
    expect(r.nextIdx).toBe(5)
  })

  it('adds a specifications containment clause for specKey+specValue', () => {
    const r = buildProductFilterClauses({ specKey: 'Weight', specValue: '2kg' }, 1)
    expect(r.conditions[0]).toContain('jsonb_build_object($1::text, $2::text)')
    expect(r.params).toEqual(['Weight', '2kg'])
  })

  it('adds an offer EXISTS clause reusing one placeholder for slug and id', () => {
    const r = buildProductFilterClauses({ offer: 'summer' }, 7)
    expect(r.conditions[0]).toContain('po.slug = $7 OR po.id::text = $7')
    expect(r.params).toEqual(['summer'])
    expect(r.nextIdx).toBe(8)
  })

  it('chains every filter with correctly advancing indices', () => {
    const r = buildProductFilterClauses(
      { minPrice: '1', brand: 'nike', color: 'red', variantType: 't', variantValue: 'v', offer: 'o' },
      1
    )
    // price $1, brand $2, color $3, variant $4/$5, offer $6
    expect(r.params).toEqual(['1', 'nike', 'red', 't', 'v', 'o'])
    expect(r.nextIdx).toBe(7)
  })
})

describe('getFilterFacets', () => {
  beforeEach(() => {
    vi.mocked(queryMany).mockReset().mockResolvedValue([])
    vi.mocked(queryOne).mockReset().mockResolvedValue(null)
  })

  it('uses TRUE as the base where when no conditions, and passes base params to every query', async () => {
    await getFilterFacets([], [])
    for (const call of vi.mocked(queryMany).mock.calls) {
      expect(String(call[0])).toContain('TRUE')
      expect(call[1]).toEqual([])
    }
  })

  it('joins base conditions with AND into each facet query', async () => {
    await getFilterFacets(['p.category_id = $1', 'p.brand_id = $2'], ['c', 'b'])
    const first = String(vi.mocked(queryMany).mock.calls[0][0])
    expect(first).toContain('p.category_id = $1 AND p.brand_id = $2')
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['c', 'b'])
  })

  it('maps rows into typed facets with numeric counts and spec grouping', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ id: 'b1', name: 'Nike', count: '3' }]) // brands
      .mockResolvedValueOnce([{ value: 'Red', hex: '#f00', count: '2' }]) // colors
      .mockResolvedValueOnce([{ value: 'A', count: '1' }]) // grades
      .mockResolvedValueOnce([{ value: 'Steel', count: '4' }]) // materials
      .mockResolvedValueOnce([]) // finishes
      .mockResolvedValueOnce([]) // compliances
      .mockResolvedValueOnce([]) // origins
      .mockResolvedValueOnce([{ value: 'Color', count: '5' }]) // variantTypes
      .mockResolvedValueOnce([{ value: 'Red', count: '5' }]) // variantValues
      .mockResolvedValueOnce([
        { key: 'Weight', val: '2kg', cnt: '2' },
        { key: 'Weight', val: '3kg', cnt: '1' },
      ]) // specRows
    vi.mocked(queryOne).mockResolvedValue({ in_stock_count: '7', on_sale_count: '2', price_min: '10', price_max: '90' })

    const f = await getFilterFacets([], [])
    expect(f.brands).toEqual([{ id: 'b1', name: 'Nike', count: 3 }])
    expect(f.colors).toEqual([{ value: 'Red', hex: '#f00', count: 2 }])
    expect(f.grades).toEqual([{ value: 'A', count: 1 }])
    expect(f.inStockCount).toBe(7)
    expect(f.onSaleCount).toBe(2)
    expect(f.priceMin).toBe(10)
    expect(f.priceMax).toBe(90)
    expect(f.variantTypes).toEqual([{ value: 'Color', count: 5 }])
    expect(f.specFacets).toEqual([
      { key: 'Weight', values: [{ value: '2kg', count: 2 }, { value: '3kg', count: 1 }] },
    ])
  })

  it('defaults aggregates to 0 and colors hex to null', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([]) // brands
      .mockResolvedValueOnce([{ value: 'Red', hex: null, count: '1' }]) // colors
      .mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue(null)
    const f = await getFilterFacets([], [])
    expect(f.inStockCount).toBe(0)
    expect(f.priceMin).toBe(0)
    expect(f.colors[0].hex).toBeNull()
  })
})
