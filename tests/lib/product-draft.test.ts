import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DB
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn() as any
const mockWithTransaction = vi.fn()

vi.mock('@/lib/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  queryMany: (...args: any[]) => mockQueryMany(...args),
  withTransaction: (...args: any[]) => mockWithTransaction(...args),
}))

const mockRecompute = vi.fn()
vi.mock('@/lib/inventory', () => ({
  recomputeStockStatusForProduct: (...args: any[]) => mockRecompute(...args),
}))

// Base fields with all boolean flags present; override per-test.
function baseFields(over: Record<string, unknown> = {}) {
  return {
    name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false,
    has_variants: false, fragile: false, hazardous: false, flammable: false,
    perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false,
    is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false,
    serialized: false, stock_status: 'In Stock', inventory_quantity: '0',
    ...over,
  }
}

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

  it('handles sub_variant_id as additional column in variant-level unit', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: {
        name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false, has_variants: false,
        fragile: false, hazardous: false, flammable: false, perishable: false, is_cod_allowed: true,
        is_oversized: false, is_digital: false, is_subscription: false, is_bundle: false,
        is_searchable: true, inclusive_tax: false, serialized: false,
        stock_status: 'In Stock', inventory_quantity: '0',
      },
      variants: [],
      images: [],
      sub_variants: [],
      // variant_id present + sub_variant_id — stored as a column in the ON CONFLICT (variant_id, unit) path
      units: [
        {
          id: 'u-sv1', unit: 'box', factor: 12, is_base: false, is_purchase_default: true,
          dimension: 'count', variant_id: 'v-1', sub_variant_id: 'sv-1',
          min_qty: 1, max_qty: 100, qty_step: 1,
        },
      ],
    }

    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(smartClientMock)

    await publishProductDraft('prod-1')
    // Uses the variant_id ON CONFLICT path; sub_variant_id is stored as param index 11 (0-based)
    const upsert = mockClientQuery.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('ON CONFLICT (variant_id, unit)')
    )
    expect(upsert).toBeDefined()
    // sub_variant_id is the 12th param (index 11)
    expect(upsert![1][11]).toBe('sv-1')
  })

  // Helper: set up transaction + queryMany and run publish with a per-SQL router.
  function setupPublish(draft: any, router: (sql: string) => any = smartClientMock, liveFlags: any = null) {
    // First queryOne = draft, second queryOne = live tracking flags
    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryOne.mockResolvedValueOnce(liveFlags)
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(router)
  }

  it('handles turnedOffVariants: deactivates variants and cleans tracking rows', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({ has_variants: false }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    // Live product had variants → toggled off
    setupPublish(draft, smartClientMock, { perishable: false, serialized: false, has_variants: true })

    await publishProductDraft('prod-1')

    const softDeactivateVariants = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_variants SET is_active = false')
    )
    expect(softDeactivateVariants.length).toBeGreaterThan(0)
    const deleteSerials = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM product_serials')
    )
    expect(deleteSerials.length).toBeGreaterThan(0)
    // turnedOffVariants forces variants=[] so live fallback not used for variants
    expect(mockRecompute).toHaveBeenCalledTimes(1)
  })

  it('handles perishable turned OFF: rolls batch stock back into inventory (variant product)', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({ perishable: false, has_variants: true }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      // perGrain query — returns a variant grain, a sub-variant grain, and a product grain
      if (sql.includes('MAX(total)')) {
        return Promise.resolve({
          rows: [
            { variant_id: 'v-1', sub_variant_id: null, total: '5' },
            { variant_id: 'v-1', sub_variant_id: 'sv-1', total: '3' },
            { variant_id: null, sub_variant_id: null, total: '8' },
          ],
          rowCount: 3,
        })
      }
      // structural has_active_variant check → true (variant product)
      if (sql.includes('has_active_variant')) {
        return Promise.resolve({ rows: [{ has_active_variant: true }], rowCount: 1 })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    // Live perishable ON → turnedOffPerishable true
    setupPublish(draft, router, { perishable: true, serialized: false, has_variants: true })

    await publishProductDraft('prod-1')

    // batches + shelf deleted
    const delBatches = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM product_batches WHERE product_id = $1')
    )
    expect(delBatches.length).toBeGreaterThan(0)
    const delShelf = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM shelf_stock')
    )
    expect(delShelf.length).toBeGreaterThan(0)
    // sub-variant + variant rollups + products rollup (variant product path)
    const prodRollup = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE products SET inventory_quantity = COALESCE')
    )
    expect(prodRollup.length).toBeGreaterThan(0)
  })

  it('handles serialized turned OFF: deletes in_stock serials (simple product)', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({ serialized: false, perishable: true, has_variants: false }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      if (sql.includes('MAX(total)')) {
        // only a product-grain count
        return Promise.resolve({ rows: [{ variant_id: null, sub_variant_id: null, total: '4' }], rowCount: 1 })
      }
      if (sql.includes('has_active_variant')) {
        return Promise.resolve({ rows: [{ has_active_variant: false }], rowCount: 1 })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    // Live serialized ON, perishable stays ON (newPerishable true → batches NOT deleted)
    setupPublish(draft, router, { perishable: true, serialized: true, has_variants: false })

    await publishProductDraft('prod-1')

    const delSerials = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("DELETE FROM product_serials WHERE product_id = $1 AND status = 'in_stock'")
    )
    expect(delSerials.length).toBeGreaterThan(0)
    // perishable stays on → NO batch delete
    const delBatches = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM product_batches WHERE product_id = $1')
    )
    expect(delBatches.length).toBe(0)
    // simple product → products SET inventory_quantity = $1
    const prodSet = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE products SET inventory_quantity = $1')
    )
    expect(prodSet.length).toBeGreaterThan(0)
  })

  it('reconciles suppliers: product leaf insert + preferred', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({
        product_suppliers: [
          { supplier_id: 'sup-1', unit_cost: '10', is_preferred: true, currency: 'INR', moq: '5', lead_time_days: '3', notes: 'n', gst_inclusive: true },
          { supplier_id: '', unit_cost: '5' }, // skipped: no supplier id
          { supplier_id: 'sup-2', unit_cost: 'NaN' }, // skipped: invalid cost
        ],
      }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      // no existing supplier row → insert new
      if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
        return Promise.resolve({ rows: [], rowCount: 0 })
      }
      // dbLeaves cleanup — none extra
      if (sql.includes('SELECT DISTINCT')) {
        return Promise.resolve({ rows: [], rowCount: 0 })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    setupPublish(draft, router, { perishable: false, serialized: false, has_variants: false })

    await publishProductDraft('prod-1')

    const insertSupplier = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_suppliers')
    )
    expect(insertSupplier.length).toBeGreaterThan(0)
    const setPreferred = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('SET is_preferred = true')
    )
    expect(setPreferred.length).toBeGreaterThan(0)
  })

  it('reconciles suppliers: variant leaf, price-change new dated row, and unchanged update', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({
        has_variants: true,
        product_suppliers: [
          { supplier_id: 'sup-1', unit_cost: 20, variant_sku: 'VAR-1', currency: 'INR' }, // price changed vs existing 10
          { supplier_id: 'sup-2', unit_cost: 15, variant_sku: 'VAR-1' }, // unchanged
        ],
      }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    let curCall = 0
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      // resolveVariantId → returns a variant id
      if (sql.includes('SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2')) {
        return Promise.resolve({ rows: [{ id: 'vid-1' }], rowCount: 1 })
      }
      // existing active supplier row
      if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
        curCall++
        // first supplier: existing cost 10 (changed → new dated row); second: cost 15 (unchanged)
        return Promise.resolve({ rows: [{ id: `ps-${curCall}`, unit_cost: curCall === 1 ? '10' : '15' }], rowCount: 1 })
      }
      if (sql.includes('SELECT DISTINCT')) {
        return Promise.resolve({ rows: [], rowCount: 0 })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    setupPublish(draft, router, { perishable: false, serialized: false, has_variants: true })

    await publishProductDraft('prod-1')

    // price change → deactivate old + insert new dated row
    const deactivateOld = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('SET is_active = false, is_preferred = false, updated_at = NOW() WHERE id = $1')
    )
    expect(deactivateOld.length).toBeGreaterThan(0)
    // unchanged → plain UPDATE currency=...
    const plainUpdate = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('SET currency = $1, gst_inclusive = $2')
    )
    expect(plainUpdate.length).toBeGreaterThan(0)
    // variant leaf cache update
    const cacheVariant = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_variants SET supplier_id')
    )
    expect(cacheVariant.length).toBeGreaterThan(0)
  })

  it('reconciles suppliers: sub-variant leaf + unresolved SKU skipped + dbLeaves cleanup', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({
        has_variants: true,
        product_suppliers: [
          { supplier_id: 'sup-1', unit_cost: 5, variant_sku: 'VAR-1', sub_variant_name: 'Red' },
          { supplier_id: 'sup-9', unit_cost: 5, variant_sku: 'MISSING' }, // variant unresolved → skip
        ],
      }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      if (sql.includes('SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2')) {
        // 'VAR-1' resolves, 'MISSING' does not
        return Promise.resolve({ rows: [{ id: 'vid-1' }], rowCount: 1 })
      }
      if (sql.includes('SELECT id FROM product_sub_variants')) {
        return Promise.resolve({ rows: [{ id: 'svid-1' }], rowCount: 1 })
      }
      if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
        return Promise.resolve({ rows: [], rowCount: 0 })
      }
      // dbLeaves — return a leaf NOT covered → triggers cleanup deactivate
      if (sql.includes('SELECT DISTINCT')) {
        return Promise.resolve({
          rows: [{ vid: '00000000-0000-0000-0000-000000000000', svid: 'orphan-sv', variant_id: null, sub_variant_id: 'orphan-sv' }],
          rowCount: 1,
        })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    // Router needs distinct resolveVariantId responses for VAR-1 (found) then MISSING (not found).
    let varLookup = 0
    const router2 = (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2')) {
        varLookup++
        return Promise.resolve({ rows: varLookup === 1 ? [{ id: 'vid-1' }] : [], rowCount: varLookup === 1 ? 1 : 0 })
      }
      return router(sql)
    }
    setupPublish(draft, router2, { perishable: false, serialized: false, has_variants: true })

    await publishProductDraft('prod-1')

    // sub-variant cache update
    const cacheSub = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_sub_variants SET supplier_id')
    )
    expect(cacheSub.length).toBeGreaterThan(0)
    // dbLeaves cleanup deactivate for orphan leaf
    const dbLeafCleanup = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_suppliers SET is_active = false') && sql.includes('is_active = true')
    )
    expect(dbLeafCleanup.length).toBeGreaterThan(0)
  })

  it('handles cleared variant units and cleared sub-variant units', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [], images: [], sub_variants: [],
      units: [
        { _cleared: true, variant_id: 'v-1', sub_variant_id: null },
        { _cleared: true, variant_id: null, sub_variant_id: 'sv-1' },
      ],
    }
    setupPublish(draft, smartClientMock, { perishable: false, serialized: false, has_variants: false })

    await publishProductDraft('prod-1')

    // cleared variant unit → DELETE + clear sell_unit_id on variant
    const delVariantUnit = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM product_units WHERE product_id = $1 AND variant_id = $2')
    )
    expect(delVariantUnit.length).toBeGreaterThan(0)
    const clearVariantSell = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_variants SET sell_unit_id = NULL')
    )
    expect(clearVariantSell.length).toBeGreaterThan(0)
    // cleared sub-variant unit → DELETE + clear sell_unit_id on sub-variant
    const delSubUnit = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM product_units WHERE product_id = $1 AND sub_variant_id = $2')
    )
    expect(delSubUnit.length).toBeGreaterThan(0)
    const clearSubSell = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_sub_variants SET sell_unit_id = NULL')
    )
    expect(clearSubSell.length).toBeGreaterThan(0)
  })

  it('inserts sub-variant-level unit via savepoint (success path)', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [], images: [], sub_variants: [],
      units: [
        { unit: 'box', factor: 12, sub_variant_id: 'sv-1', variant_id: null, is_base: false },
      ],
    }
    setupPublish(draft, smartClientMock, { perishable: false, serialized: false, has_variants: false })

    await publishProductDraft('prod-1')

    const savepoint = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('SAVEPOINT sv_unit')
    )
    expect(savepoint.length).toBeGreaterThan(0)
    const release = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('RELEASE SAVEPOINT sv_unit')
    )
    expect(release.length).toBeGreaterThan(0)
  })

  it('sub-variant-level unit unique-violation → rolls back and updates in place', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [], images: [], sub_variants: [],
      units: [
        { unit: 'box', factor: 12, sub_variant_id: 'sv-1', variant_id: null },
      ],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      // The sub-variant INSERT ... ON CONFLICT (sub_variant_id, unit) collides on (product_id, unit)
      if (sql.includes('ON CONFLICT (sub_variant_id, unit)')) {
        const err: any = new Error('duplicate key')
        err.code = '23505'
        return Promise.reject(err)
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    setupPublish(draft, router, { perishable: false, serialized: false, has_variants: false })

    await publishProductDraft('prod-1')

    const rollback = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('ROLLBACK TO SAVEPOINT sv_unit')
    )
    expect(rollback.length).toBeGreaterThan(0)
    // fallback in-place UPDATE
    const inPlace = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE product_units SET') && sql.includes('AND unit = $14')
    )
    expect(inPlace.length).toBeGreaterThan(0)
  })

  it('sub-variant-level unit non-unique error → rethrows', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [], images: [], sub_variants: [],
      units: [
        { unit: 'box', factor: 12, sub_variant_id: 'sv-1', variant_id: null },
      ],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 })
      if (sql.includes('ON CONFLICT (sub_variant_id, unit)')) {
        const err: any = new Error('some other db error')
        err.code = '42P01'
        return Promise.reject(err)
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    mockQueryOne.mockResolvedValueOnce(draft)
    mockQueryOne.mockResolvedValueOnce({ perishable: false, serialized: false, has_variants: false })
    mockQueryMany.mockResolvedValue([])
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockImplementation(router)

    await expect(publishProductDraft('prod-1')).rejects.toThrow('some other db error')
  })

  it('skips deletion of sub-variants when order_items reference them (COUNT > 0)', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [], images: [],
      sub_variants: [{ _seeded: true, variant_id: 'v-1', sub_variant_name: 'Red', is_active: true }],
      units: [],
    }
    const router = (sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 })
      // order_items reference count > 0 → do NOT delete existing sub-variants
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '2' }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    setupPublish(draft, router, { perishable: false, serialized: false, has_variants: false })

    await publishProductDraft('prod-1')

    const delSubVariants = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('DELETE FROM product_sub_variants WHERE variant_id = $1')
    )
    // COUNT > 0 → deletion skipped
    expect(delSubVariants.length).toBe(0)
    // but insert still happens for staged sv
    const insertSv = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_sub_variants')
    )
    expect(insertSv.length).toBeGreaterThan(0)
  })

  it('coerces empty-string numerics to null for staged sub-variant', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [], images: [],
      sub_variants: [{
        _edited: true, variant_id: 'v-1', sub_variant_name: 'Blue',
        price: '', mrp: 'abc', price_ex_gst: null, mrp_ex_gst: '5',
        inventory_quantity: '', discount_pct: '', is_active: null,
      }],
      units: [],
    }
    setupPublish(draft, smartClientMock, { perishable: false, serialized: false, has_variants: false })

    await publishProductDraft('prod-1')

    const insertSv = mockClientQuery.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO product_sub_variants')
    )
    expect(insertSv).toBeDefined()
    const params = insertSv![1]
    // params: [vid, productId, sku, name, price, mrp, price_ex_gst, mrp_ex_gst, attributes, is_active, inv, disc, status]
    expect(params[4]).toBeNull() // price '' -> null
    expect(params[5]).toBeNull() // mrp 'abc' -> null
    expect(params[6]).toBeNull() // price_ex_gst null -> null
    expect(params[7]).toBe(5)    // mrp_ex_gst '5' -> 5
    expect(params[10]).toBe(0)   // inventory_quantity '' -> null ?? 0
    expect(params[11]).toBe(0)   // discount_pct '' -> null ?? 0
    expect(params[9]).toBe(true) // is_active null -> true
  })

  it('uses perishable/serialized string "true" values from draft fields', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields({ perishable: 'true', serialized: 'true', has_variants: 'true' }),
      variants: [], images: [], sub_variants: [], units: [],
    }
    // Live flags all on but new ones also on (string 'true') → no toggle-off
    setupPublish(draft, smartClientMock, { perishable: true, serialized: true, has_variants: true })

    await publishProductDraft('prod-1')

    // no toggle-off cleanup (MAX(total) query never issued)
    const perGrain = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('MAX(total)')
    )
    expect(perGrain.length).toBe(0)
  })
})
