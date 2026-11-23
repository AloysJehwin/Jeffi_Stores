import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import {
  piecesPerUnit,
  sellingUnitsFor,
  resolveUnitChain,
  unitChainsFor,
  asSellingUnit,
  type LineUnit,
} from '@/lib/catalog/unit-factor'
import { queryMany } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => mockQueryMany.mockReset())

const puRow = (over: Record<string, any> = {}) => ({
  product_id: 'p1',
  variant_id: null,
  sub_variant_id: null,
  unit: 'box',
  factor: '12',
  is_base: true,
  dimension: 'count',
  ...over,
})

describe('sellingUnitsFor', () => {
  it('no product ids → all null/1, no units query', async () => {
    const out = await sellingUnitsFor([{}, {}])
    expect(out).toEqual([
      { unit: null, factor: 1 },
      { unit: null, factor: 1 },
    ])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('count base unit gives its factor', async () => {
    mockQueryMany.mockResolvedValueOnce([puRow()] as any)
    const out = await sellingUnitsFor([{ productId: 'p1' }])
    expect(out).toEqual([{ unit: 'box', factor: 12 }])
    expect(mockQueryMany.mock.calls[0][1]).toEqual([['p1']])
  })

  it('measured (non-count) dimension never multiplies → factor 1', async () => {
    mockQueryMany.mockResolvedValueOnce([puRow({ unit: 'm', factor: '5', dimension: 'length' })] as any)
    const out = await sellingUnitsFor([{ productId: 'p1' }])
    expect(out).toEqual([{ unit: 'm', factor: 1 }])
  })

  it('picks the requested unit by name over the base', async () => {
    mockQueryMany.mockResolvedValueOnce([
      puRow({ unit: 'pc', factor: '1', is_base: true }),
      puRow({ unit: 'box', factor: '12', is_base: false }),
    ] as any)
    const out = await sellingUnitsFor([{ productId: 'p1', unit: ' BOX ' }])
    expect(out).toEqual([{ unit: 'box', factor: 12 }])
  })

  it('resolves an orphan variant id to its product', async () => {
    // first call: owners lookup; second: product_units
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'v1', product_id: 'p1' }] as any)
      .mockResolvedValueOnce([puRow({ variant_id: 'v1', unit: 'set', factor: '4' })] as any)
    const out = await sellingUnitsFor([{ variantId: 'v1' }])
    expect(out).toEqual([{ unit: 'set', factor: 4 }])
    expect(mockQueryMany.mock.calls[0][0]).toContain('product_variants')
  })

  it('sub-variant scope beats variant and product', async () => {
    mockQueryMany.mockResolvedValueOnce([
      puRow({ unit: 'pc', factor: '1' }),
      puRow({ variant_id: 'v1', sub_variant_id: 'sv1', unit: 'tray', factor: '6', is_base: true }),
    ] as any)
    const out = await sellingUnitsFor([{ productId: 'p1', variantId: 'v1', subVariantId: 'sv1' }])
    expect(out).toEqual([{ unit: 'tray', factor: 6 }])
  })

  it('unknown line (no matching rows) → null/1', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    const out = await sellingUnitsFor([{ productId: 'p1' }])
    expect(out).toEqual([{ unit: null, factor: 1 }])
  })
})

describe('piecesPerUnit', () => {
  it('maps to the factors', async () => {
    mockQueryMany.mockResolvedValueOnce([puRow()] as any)
    expect(await piecesPerUnit([{ productId: 'p1' }])).toEqual([12])
  })
})

describe('resolveUnitChain', () => {
  const row = (over: Record<string, any> = {}) => ({
    variant_id: null,
    sub_variant_id: null,
    unit: 'pc',
    is_base: false,
    ...over,
  })

  it('most specific scope wins, default first and only is_base', () => {
    const chain = resolveUnitChain(
      [
        row({ unit: 'pc', is_base: true }),
        row({ variant_id: 'v1', unit: 'box', is_base: true }),
        row({ variant_id: 'v1', unit: 'case', is_base: false }),
      ],
      'v1'
    )
    // variant scope (depth 1) is more specific than product; its base 'box' leads
    expect(chain[0]).toMatchObject({ unit: 'box', is_base: true })
    expect(chain.filter(u => u.is_base)).toHaveLength(1)
    expect(chain.map(u => u.unit)).toContain('case')
  })

  it('dedupes by unit name (case-insensitive)', () => {
    const chain = resolveUnitChain([row({ unit: 'Box' }), row({ unit: 'box' })])
    expect(chain).toHaveLength(1)
  })

  it('no base flagged → keeps order, nothing is_base', () => {
    const chain = resolveUnitChain([row({ unit: 'a' }), row({ unit: 'b' })])
    expect(chain.every(u => !u.is_base)).toBe(true)
  })
})

describe('unitChainsFor', () => {
  it('no product ids → empty chains, no query', async () => {
    expect(await unitChainsFor([])).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('shapes rows into LineUnit with defaults', async () => {
    mockQueryMany.mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        unit: 'box',
        display_label: null,
        factor: '12',
        dimension: null,
        is_base: true,
        min_qty: '1',
        max_qty: null,
        qty_step: '1',
      },
    ] as any)
    const out = await unitChainsFor([{ productId: 'p1' }])
    expect(out[0][0]).toEqual({
      unit: 'box',
      label: 'box', // falls back to unit
      factor: 12,
      dimension: 'count', // default
      minQty: 1,
      maxQty: null,
      qtyStep: 1,
      isDefault: true,
    })
  })
})

describe('asSellingUnit', () => {
  it('reshapes a LineUnit', () => {
    const lu: LineUnit = {
      unit: 'm',
      label: 'metre',
      factor: 1,
      dimension: 'length',
      minQty: 0.5,
      maxQty: 100,
      qtyStep: 0.5,
      isDefault: true,
    }
    expect(asSellingUnit(lu)).toEqual({
      unit: 'm',
      factor: 1,
      dimension: 'length',
      qty_step: 0.5,
      min_qty: 0.5,
      max_qty: 100,
    })
  })
})
