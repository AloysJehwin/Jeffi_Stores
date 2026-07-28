import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DB
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn()
const mockWithTransaction = vi.fn()

vi.mock('@/lib/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  queryMany: (...args: any[]) => mockQueryMany(...args),
  withTransaction: (...args: any[]) => mockWithTransaction(...args),
}))

// Smart client mock: returns count row for COUNT queries, empty rows otherwise
function smartClientMock(sql: string) {
  if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
    return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
  }
  return Promise.resolve({ rows: [], rowCount: 0 })
}

import { publishProductDraft } from '@/lib/product-draft'

describe('publishProductDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when draft not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(publishProductDraft('no-such-id')).rejects.toThrow('Draft not found')
  })

  it('runs transaction when draft exists', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: {
        name: 'Test Product',
        sku: 'TEST-001',
        slug: 'test-product',
        base_price: '100',
        is_featured: true,
        has_variants: false,
        fragile: false,
        hazardous: false,
        flammable: false,
        perishable: false,
        is_cod_allowed: true,
        is_oversized: false,
        is_digital: false,
        is_subscription: false,
        is_bundle: false,
        is_searchable: true,
        inclusive_tax: false,
        serialized: false,
        stock_status: 'In Stock',
        inventory_quantity: '10',
      },
      variants: [],
      images: [{ image_url: 'img.jpg', is_primary: true, display_order: 0 }],
      sub_variants: [],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)

    // withTransaction calls the callback with a client
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)
    // queryMany fallbacks for empty variants/subvariants/units
    mockQueryMany.mockResolvedValue([])

    await publishProductDraft('prod-1')

    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    // Should run UPDATE products, DELETE product_images, INSERT images, DELETE draft
    expect(mockClientQuery.mock.calls.length).toBeGreaterThan(2)
  })

  it('falls back to live variants when draft.variants is empty', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [],
      images: [],
      sub_variants: [],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)

    // queryMany called for fallback variants/subvariants/units
    mockQueryMany.mockResolvedValue([])

    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // queryMany should be called for live fallback
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('skips variant update when no valid SKUs', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [{ id: 'v1', sku: null }], // no valid SKU
      images: [],
      sub_variants: [],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    const variantDeactivateCalls = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('is_active = false') && sql.includes('product_variants')
    )
    expect(variantDeactivateCalls.length).toBe(0)
  })

  it('UPSERTs variants with valid SKUs', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '100', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0', sub_variant_type_on: false, use_own_images: false },
      variants: [{ id: 'v1', sku: 'VAR-001', variant_name: 'Red', price: '100', is_active: true, stock_status: 'In Stock', pricing_type: 'unit', inventory_quantity: '5', discount_pct: '0', stock_decimal_precision: '0', sub_variant_type_on: false, use_own_images: false }],
      images: [],
      sub_variants: [],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 })

    await publishProductDraft('prod-1')
    // Should call deactivate + UPSERT for variant
    const upsertCalls = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_variants')
    )
    expect(upsertCalls.length).toBeGreaterThan(0)
  })

  it('handles staged sub-variants with _cleared sentinel', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: false, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [],
      images: [],
      sub_variants: [{ _cleared: true, id: 'cleared-1', variant_id: 'v-1', sub_variant_id: null }],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  it('handles staged sub-variants with draft-sv- IDs', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: false, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [],
      images: [],
      sub_variants: [{
        id: 'draft-sv-123',
        variant_id: 'v-1',
        sub_variant_name: 'Red',
        sku: 'SV-RED',
        price: 100,
        is_active: true,
        inventory_quantity: 10,
        discount_pct: 0,
        stock_status: 'In Stock',
      }],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // Should INSERT sub-variant
    const svInserts = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_sub_variants')
    )
    expect(svInserts.length).toBeGreaterThan(0)
  })

  it('handles product-level units with cleared sentinels filtered', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: false, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [],
      images: [],
      sub_variants: [],
      units: [
        { id: 'u-1', unit: 'pc', factor: 1, is_base: true, is_purchase_default: false, dimension: 'count', variant_id: null, sub_variant_id: null, min_qty: 1, max_qty: null, qty_step: 1 },
        { _cleared: true, id: 'cleared-v1', variant_id: 'v-1', sub_variant_id: null },
      ],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    const unitInserts = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_units')
    )
    expect(unitInserts.length).toBeGreaterThan(0)
  })

  it('deactivates sub-variants when sub_variant_type_on=false', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '100', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [{ id: 'v1', sku: 'VAR-001', variant_name: 'Red', price: '100', is_active: true, stock_status: 'In Stock', pricing_type: 'unit', inventory_quantity: '5', discount_pct: '0', stock_decimal_precision: '0', sub_variant_type_on: false, use_own_images: true }],
      images: [],
      sub_variants: [],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // sub_variant_type_on=false triggers UPDATE product_sub_variants SET is_active = false
    const deactivateSv = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('product_sub_variants') && sql.includes('is_active = false')
    )
    expect(deactivateSv.length).toBeGreaterThan(0)
  })

  it('deletes variant images when use_own_images=false', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '100', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [{ id: 'v1', sku: 'VAR-001', variant_name: 'Blue', price: '100', is_active: true, stock_status: 'In Stock', pricing_type: 'unit', inventory_quantity: '5', discount_pct: '0', stock_decimal_precision: '0', sub_variant_type_on: false, use_own_images: false }],
      images: [],
      sub_variants: [],
      units: [],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // use_own_images=false triggers DELETE FROM variant_images
    const deleteImages = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM variant_images')
    )
    expect(deleteImages.length).toBeGreaterThan(0)
  })

  it('publishes with variant-level units', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '100', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [],
      images: [],
      sub_variants: [],
      units: [
        { id: 'u-v1', unit: 'pair', factor: 2, is_base: true, is_purchase_default: false, dimension: 'count', variant_id: 'v-1', sub_variant_id: null, min_qty: 1, max_qty: null, qty_step: 1 },
      ],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // variant-level unit should trigger UPSERT
    const variantUnitUpsert = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_units') && sql.includes('ON CONFLICT')
    )
    expect(variantUnitUpsert.length).toBeGreaterThan(0)
  })

  it('handles variant unit with minimal fields (all ?? defaults applied)', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: { name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: true, fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false, serialized: false, stock_status: 'In Stock', inventory_quantity: '0' },
      variants: [],
      images: [],
      sub_variants: [],
      units: [
        // Minimal unit — all optional fields undefined, forces all ?? branches
        { id: 'u-v1', unit: 'pc', variant_id: 'v-1' },
      ],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // The ?? defaults (factor??1, is_base??false, etc.) should be applied
    const upsert = mockClientQuery.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('ON CONFLICT (variant_id, unit)')
    )
    expect(upsert).toBeDefined()
    // factor defaults to 1
    expect(upsert![1][3]).toBe(1)
    // is_base defaults to false
    expect(upsert![1][4]).toBe(false)
  })
})
