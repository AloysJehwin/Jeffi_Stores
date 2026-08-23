import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supplements tests/lib/product-draft.test.ts to cover the staged variant_images
// reconcile block (delete-not-kept, insert draft-vi- uploads, apply order/primary
// on kept rows, guarantee-one-primary) and the sub-variant UPDATE-by-id path.

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

function baseFields(over: Record<string, unknown> = {}) {
  return {
    name: 'P', sku: 'S', slug: 's', base_price: '0', is_featured: false,
    has_variants: true, fragile: false, hazardous: false, flammable: false,
    perishable: false, is_cod_allowed: true, is_oversized: false, is_digital: false,
    is_subscription: false, is_bundle: false, is_searchable: true, inclusive_tax: false,
    serialized: false, stock_status: 'In Stock', inventory_quantity: '0',
    ...over,
  }
}

import { publishProductDraft } from '@/lib/product-draft'

const V_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTransaction.mockImplementation(async (fn: any) => { await fn({ query: mockClientQuery }) })
  mockQueryMany.mockResolvedValue([])
  // Live flags query (perishable/serialized/has_variants) — keep everything on so
  // no toggle-off cleanup fires; has_variants stays on.
  mockQueryOne.mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('perishable, serialized, has_variants')) {
      return Promise.resolve({ perishable: false, serialized: false, has_variants: true })
    }
    return Promise.resolve(null)
  })
})

describe('publishProductDraft — variant_images reconcile', () => {
  it('inserts staged draft-vi uploads, keeps a live row, and applies primary/order', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [{ sku: 'SKU-1', variant_name: 'V1', use_own_images: true, sub_variant_type_on: false }],
      images: [],
      sub_variants: [],
      units: [],
      variant_images: [
        // kept live row (real uuid), not primary
        { id: '00000000-0000-4000-8000-0000000000aa', variant_id: V_ID, display_order: 1, is_primary: false },
        // fresh upload (draft-vi- id) → INSERT, marked primary
        { id: 'draft-vi-123', variant_id: V_ID, image_url: 'https://cdn/new.jpg', display_order: 0, is_primary: true, s3_key: 'k', width: 5, height: 6 },
      ],
    }
    // First queryOne = SELECT * FROM product_drafts
    mockQueryOne.mockResolvedValueOnce(draft as any)

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('is_active = true') && sql.includes('SELECT id FROM product_variants')) {
        return Promise.resolve({ rows: [{ id: V_ID }] })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await publishProductDraft('prod-1')

    const sqls = mockClientQuery.mock.calls.map((c: any[]) => String(c[0]))
    // DELETE live rows not kept
    expect(sqls.some(s => s.includes('DELETE FROM variant_images WHERE variant_id'))).toBe(true)
    // INSERT the freshly-staged upload
    expect(sqls.some(s => s.includes('INSERT INTO variant_images'))).toBe(true)
    // UPDATE kept live row's display_order + is_primary
    expect(sqls.some(s => s.includes('UPDATE variant_images SET display_order'))).toBe(true)
  })

  it('guarantees one primary when no staged row is primary', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [{ sku: 'SKU-1', variant_name: 'V1', use_own_images: true, sub_variant_type_on: false }],
      images: [],
      sub_variants: [],
      units: [],
      variant_images: [
        { id: 'draft-vi-1', variant_id: V_ID, image_url: 'https://cdn/a.jpg', display_order: 0, is_primary: false },
        { id: 'draft-vi-2', variant_id: V_ID, image_url: 'https://cdn/b.jpg', display_order: 1, is_primary: false },
      ],
    }
    mockQueryOne.mockResolvedValueOnce(draft as any)
    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('is_active = true') && sql.includes('SELECT id FROM product_variants')) {
        return Promise.resolve({ rows: [{ id: V_ID }] })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await publishProductDraft('prod-1')

    const sqls = mockClientQuery.mock.calls.map((c: any[]) => String(c[0]))
    // Fallback: promote first image to primary
    expect(sqls.some(s => s.includes('UPDATE variant_images SET is_primary = TRUE'))).toBe(true)
  })

  it('reconciles an active variant with zero staged rows (clears its live images)', async () => {
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [{ sku: 'SKU-1', variant_name: 'V1', use_own_images: true, sub_variant_type_on: false }],
      images: [],
      sub_variants: [],
      units: [],
      variant_images: [], // nothing staged, but the variant is active
    }
    mockQueryOne.mockResolvedValueOnce(draft as any)
    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('is_active = true') && sql.includes('SELECT id FROM product_variants')) {
        return Promise.resolve({ rows: [{ id: V_ID }] })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await publishProductDraft('prod-1')

    const sqls = mockClientQuery.mock.calls.map((c: any[]) => String(c[0]))
    // The active variant still gets a DELETE with an empty keep-set (keepIds = []).
    expect(sqls.some(s => s.includes('DELETE FROM variant_images WHERE variant_id'))).toBe(true)
  })
})

describe('publishProductDraft — sub-variant UPDATE-by-id', () => {
  it('updates an existing sub-variant in place when it carries a real uuid id + _edited marker', async () => {
    const SV_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
    const draft = {
      product_id: 'prod-1',
      fields: baseFields(),
      variants: [{ sku: 'SKU-1', variant_name: 'V1', use_own_images: false, sub_variant_type_on: true }],
      images: [],
      sub_variants: [
        { id: SV_ID, _edited: true, variant_id: V_ID, sub_variant_name: 'S1', price: '10', mrp: '', is_active: true },
      ],
      units: [],
      variant_images: [],
    }
    mockQueryOne.mockResolvedValueOnce(draft as any)
    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('is_active = true') && sql.includes('SELECT id FROM product_variants')) {
        return Promise.resolve({ rows: [{ id: V_ID }] })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await publishProductDraft('prod-1')

    const sqls = mockClientQuery.mock.calls.map((c: any[]) => String(c[0]))
    // UPDATE product_sub_variants by id (not INSERT), preserving inventory_quantity.
    expect(sqls.some(s => s.includes('UPDATE product_sub_variants SET') && s.includes('sub_variant_name'))).toBe(true)
  })
})
