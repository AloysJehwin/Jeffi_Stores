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
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
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
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 })

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
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    await publishProductDraft('prod-1')
    // Should not call UPDATE product_variants SET is_active = false with empty SKU list
    const variantDeactivateCalls = mockClientQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('is_active = false') && sql.includes('product_variants')
    )
    expect(variantDeactivateCalls.length).toBe(0)
  })
})
