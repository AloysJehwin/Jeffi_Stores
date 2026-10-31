import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockQueryMany, mockQueryOne } = vi.hoisted(() => ({
  mockQueryMany: vi.fn(),
  mockQueryOne: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: mockQueryMany,
  queryOne: mockQueryOne,
}))

import { buildProductFilterClauses, getFilterFacets } from '@/lib/catalog/product-filters'

describe('buildProductFilterClauses', () => {
  it('returns empty clauses for empty params', () => {
    const res = buildProductFilterClauses({}, 1)
    expect(res.conditions).toEqual([])
    expect(res.params).toEqual([])
    expect(res.nextIdx).toBe(1)
  })

  it('adds minPrice clause when present', () => {
    const res = buildProductFilterClauses({ minPrice: '100' }, 1)
    expect(res.conditions[0]).toContain('>= $1::numeric')
    expect(res.params).toEqual(['100'])
    expect(res.nextIdx).toBe(2)
  })

  it('skips minPrice when empty string', () => {
    const res = buildProductFilterClauses({ minPrice: '' }, 1)
    expect(res.conditions).toEqual([])
    expect(res.nextIdx).toBe(1)
  })

  it('adds maxPrice clause when present', () => {
    const res = buildProductFilterClauses({ maxPrice: '500' }, 1)
    expect(res.conditions[0]).toContain('<= $1::numeric')
    expect(res.params).toEqual(['500'])
    expect(res.nextIdx).toBe(2)
  })

  it('skips maxPrice when empty string', () => {
    const res = buildProductFilterClauses({ maxPrice: '' }, 3)
    expect(res.conditions).toEqual([])
    expect(res.nextIdx).toBe(3)
  })

  it('adds both minPrice and maxPrice, incrementing index', () => {
    const res = buildProductFilterClauses({ minPrice: '10', maxPrice: '99' }, 1)
    expect(res.conditions).toHaveLength(2)
    expect(res.conditions[0]).toContain('$1')
    expect(res.conditions[1]).toContain('$2')
    expect(res.params).toEqual(['10', '99'])
    expect(res.nextIdx).toBe(3)
  })

  it('adds inStock clause when inStock === "1"', () => {
    const res = buildProductFilterClauses({ inStock: '1' }, 1)
    expect(res.conditions).toContain(`p.stock_status != 'Out of Stock'`)
  })

  it('does not add inStock clause when inStock !== "1"', () => {
    const res = buildProductFilterClauses({ inStock: '0' }, 1)
    expect(res.conditions).toEqual([])
  })

  it('adds onSale clause when onSale === "1"', () => {
    const res = buildProductFilterClauses({ onSale: '1' }, 1)
    expect(res.conditions).toContain(`p.discount_pct > 0`)
  })

  it('does not add onSale clause when onSale !== "1"', () => {
    const res = buildProductFilterClauses({ onSale: 'yes' }, 1)
    expect(res.conditions).toEqual([])
  })

  it('adds brand clause for a single brand', () => {
    const res = buildProductFilterClauses({ brand: 'acme' }, 1)
    expect(res.conditions[0]).toContain('p.brand_id IN')
    expect(res.params).toEqual(['acme'])
    // one placeholder consumed (reused in both IN lists)
    expect(res.nextIdx).toBe(2)
  })

  it('adds brand clause for multiple brands', () => {
    const res = buildProductFilterClauses({ brand: 'acme, globex ,' }, 1)
    expect(res.params).toEqual(['acme', 'globex'])
    expect(res.conditions[0]).toContain('IN')
  })

  it('skips brand when it resolves to only empties', () => {
    const res = buildProductFilterClauses({ brand: ' , , ' }, 1)
    expect(res.conditions).toEqual([])
    expect(res.nextIdx).toBe(1)
  })

  it('adds IN clauses for color/grade/material/finish/compliance/origin', () => {
    const res = buildProductFilterClauses(
      {
        color: 'red,blue',
        grade: 'A',
        material: 'steel',
        finish: 'matte',
        compliance: 'ISO',
        origin: 'IN',
      },
      1
    )
    expect(res.conditions.some(c => c.includes('p.color IN'))).toBe(true)
    expect(res.conditions.some(c => c.includes('p.grade IN'))).toBe(true)
    expect(res.conditions.some(c => c.includes('p.material IN'))).toBe(true)
    expect(res.conditions.some(c => c.includes('p.finish IN'))).toBe(true)
    expect(res.conditions.some(c => c.includes('p.compliance_standard IN'))).toBe(true)
    expect(res.conditions.some(c => c.includes('p.country_of_origin IN'))).toBe(true)
    // color has 2 values, others 1 each => 7 params total
    expect(res.params).toEqual(['red', 'blue', 'A', 'steel', 'matte', 'ISO', 'IN'])
  })

  it('skips an IN filter when the raw value is empty', () => {
    const res = buildProductFilterClauses({ color: '' }, 1)
    expect(res.conditions).toEqual([])
  })

  it('skips an IN filter when values are only whitespace/commas (inClause returns null)', () => {
    const res = buildProductFilterClauses({ color: ' , ' }, 1)
    expect(res.conditions).toEqual([])
    expect(res.nextIdx).toBe(1)
  })

  it('adds variant EXISTS clause when both variantType and variantValue present', () => {
    const res = buildProductFilterClauses({ variantType: 'size', variantValue: 'L' }, 1)
    expect(res.conditions[0]).toContain('product_variants pv')
    expect(res.params).toEqual(['size', 'L'])
    expect(res.nextIdx).toBe(3)
  })

  it('skips variant clause when only variantType present', () => {
    const res = buildProductFilterClauses({ variantType: 'size' }, 1)
    expect(res.conditions).toEqual([])
  })

  it('skips variant clause when only variantValue present', () => {
    const res = buildProductFilterClauses({ variantValue: 'L' }, 1)
    expect(res.conditions).toEqual([])
  })

  it('adds spec clause when both specKey and specValue present', () => {
    const res = buildProductFilterClauses({ specKey: 'voltage', specValue: '12V' }, 1)
    expect(res.conditions[0]).toContain('jsonb_build_object')
    expect(res.params).toEqual(['voltage', '12V'])
    expect(res.nextIdx).toBe(3)
  })

  it('skips spec clause when only specKey present', () => {
    const res = buildProductFilterClauses({ specKey: 'voltage' }, 1)
    expect(res.conditions).toEqual([])
  })

  it('composes all filters and keeps indices consistent', () => {
    const res = buildProductFilterClauses(
      {
        minPrice: '5',
        maxPrice: '50',
        inStock: '1',
        onSale: '1',
        brand: 'acme',
        color: 'red',
        variantType: 'size',
        variantValue: 'L',
        specKey: 'k',
        specValue: 'v',
      },
      1
    )
    expect(res.conditions.length).toBeGreaterThan(5)
    expect(res.params.length).toBeGreaterThan(0)
  })
})

describe('getFilterFacets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function primeQueries(opts: { specRows?: any[]; aggregates?: any } = {}) {
    // 11 Promise.all entries: brands, colors, grades, materials, finishes,
    // compliances, origins, aggregates(queryOne), variantTypes, variantValues, specRows
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'b1', name: 'Acme', count: '3' }]) // brands
      .mockResolvedValueOnce([{ value: 'red', hex: '#f00', count: '2' }]) // colors
      .mockResolvedValueOnce([{ value: 'A', count: '1' }]) // grades
      .mockResolvedValueOnce([{ value: 'steel', count: '1' }]) // materials
      .mockResolvedValueOnce([{ value: 'matte', count: '1' }]) // finishes
      .mockResolvedValueOnce([{ value: 'ISO', count: '1' }]) // compliances
      .mockResolvedValueOnce([{ value: 'IN', count: '1' }]) // origins
      // aggregates is queryOne — handled separately
      .mockResolvedValueOnce([{ value: 'size', count: '4' }]) // variantTypes
      .mockResolvedValueOnce([{ value: 'L', count: '2' }]) // variantValues
      .mockResolvedValueOnce(
        opts.specRows ?? [
          { key: 'voltage', val: '12V', cnt: '2' },
          { key: 'voltage', val: '24V', cnt: '1' },
          { key: 'weight', val: '1kg', cnt: '5' },
        ]
      ) // specRows
    mockQueryOne.mockResolvedValueOnce(
      opts.aggregates ?? { in_stock_count: '7', on_sale_count: '2', price_min: '5', price_max: '99' }
    )
  }

  it('maps all facet groups from query results', async () => {
    primeQueries()
    const facets = await getFilterFacets(["p.color = 'red'"], ['red'])

    expect(facets.brands).toEqual([{ id: 'b1', name: 'Acme', count: 3 }])
    expect(facets.colors).toEqual([{ value: 'red', hex: '#f00', count: 2 }])
    expect(facets.grades).toEqual([{ value: 'A', count: 1 }])
    expect(facets.materials).toEqual([{ value: 'steel', count: 1 }])
    expect(facets.finishes).toEqual([{ value: 'matte', count: 1 }])
    expect(facets.compliances).toEqual([{ value: 'ISO', count: 1 }])
    expect(facets.origins).toEqual([{ value: 'IN', count: 1 }])
    expect(facets.inStockCount).toBe(7)
    expect(facets.onSaleCount).toBe(2)
    expect(facets.priceMin).toBe(5)
    expect(facets.priceMax).toBe(99)
    expect(facets.variantTypes).toEqual([{ value: 'size', count: 4 }])
    expect(facets.variantValues).toEqual([{ value: 'L', count: 2 }])
    // spec facets grouped by key
    expect(facets.specFacets).toEqual([
      {
        key: 'voltage',
        values: [
          { value: '12V', count: 2 },
          { value: '24V', count: 1 },
        ],
      },
      { key: 'weight', values: [{ value: '1kg', count: 5 }] },
    ])
  })

  it('uses TRUE as baseWhere when no base conditions given', async () => {
    primeQueries()
    await getFilterFacets([], [])
    // brands query is the first queryMany call
    const brandSql = mockQueryMany.mock.calls[0][0] as string
    expect(brandSql).toContain('TRUE')
  })

  it('joins base conditions with AND when provided', async () => {
    primeQueries()
    await getFilterFacets(['a = 1', 'b = 2'], [])
    const brandSql = mockQueryMany.mock.calls[0][0] as string
    expect(brandSql).toContain('a = 1 AND b = 2')
  })

  it('defaults numeric aggregates and null hex when data missing', async () => {
    mockQueryMany
      .mockResolvedValueOnce([]) // brands
      .mockResolvedValueOnce([{ value: 'green', hex: null, count: '1' }]) // colors (null hex)
      .mockResolvedValueOnce([]) // grades
      .mockResolvedValueOnce([]) // materials
      .mockResolvedValueOnce([]) // finishes
      .mockResolvedValueOnce([]) // compliances
      .mockResolvedValueOnce([]) // origins
      .mockResolvedValueOnce([]) // variantTypes
      .mockResolvedValueOnce([]) // variantValues
      .mockResolvedValueOnce([]) // specRows
    mockQueryOne.mockResolvedValueOnce(null) // aggregates null

    const facets = await getFilterFacets([], [])
    expect(facets.colors).toEqual([{ value: 'green', hex: null, count: 1 }])
    expect(facets.inStockCount).toBe(0)
    expect(facets.onSaleCount).toBe(0)
    expect(facets.priceMin).toBe(0)
    expect(facets.priceMax).toBe(0)
    expect(facets.specFacets).toEqual([])
  })

  it('handles colors where hex is undefined -> null', async () => {
    mockQueryMany
      .mockResolvedValueOnce([]) // brands
      .mockResolvedValueOnce([{ value: 'blue', count: '1' } as any]) // colors, no hex key
      .mockResolvedValueOnce([]) // grades
      .mockResolvedValueOnce([]) // materials
      .mockResolvedValueOnce([]) // finishes
      .mockResolvedValueOnce([]) // compliances
      .mockResolvedValueOnce([]) // origins
      .mockResolvedValueOnce([]) // variantTypes
      .mockResolvedValueOnce([]) // variantValues
      .mockResolvedValueOnce([]) // specRows
    mockQueryOne.mockResolvedValueOnce({ in_stock_count: '0', on_sale_count: '0', price_min: null, price_max: null })

    const facets = await getFilterFacets([], [])
    expect(facets.colors[0].hex).toBeNull()
    expect(facets.priceMin).toBe(0)
    expect(facets.priceMax).toBe(0)
  })
})
