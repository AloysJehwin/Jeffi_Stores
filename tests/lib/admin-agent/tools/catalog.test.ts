import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '(SELECT MIN(price) FROM product_variants WHERE product_id = p.id)',
  EFFECTIVE_STOCK_SQL: 'COALESCE(stock, 0)',
}))

import { CATALOG_TOOLS } from '@/lib/admin-agent/tools/catalog'
import * as db from '@/lib/db'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockQuery = vi.mocked(db.query)

function getTool(name: string) {
  return CATALOG_TOOLS.find(t => t.name === name)!
}

describe('admin-agent/tools/catalog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('CATALOG_TOOLS array', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(CATALOG_TOOLS)).toBe(true)
      expect(CATALOG_TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of CATALOG_TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  // list_featured_products returns ok({ ... }) via the tool-envelope helper
  describe('list_featured_products', () => {
    it('returns featured products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Widget', is_featured: true },
      ])
      const result = await getTool('list_featured_products').handler({})
      // ok() wraps with { ok: true, ... }
      expect(result.ok).toBe(true)
    })
  })

  // list_brands returns { brands, count, truncated } — no ok wrapper
  describe('list_brands', () => {
    it('returns brands list', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'b1', name: 'Acme', slug: 'acme' },
        { id: 'b2', name: 'Beta', slug: 'beta' },
      ])
      const result = await getTool('list_brands').handler({})
      expect(Array.isArray(result.brands)).toBe(true)
      expect(result.count).toBe(2)
    })
  })

  // get_brand takes { id } — source param is 'id', not 'brand_id'
  // returns raw row or { error } — no ok wrapper
  describe('get_brand', () => {
    it('returns brand by id', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'b1', name: 'Acme' })
      const result = await getTool('get_brand').handler({ id: 'b1' })
      expect(result).toHaveProperty('id', 'b1')
      expect(result).toHaveProperty('name', 'Acme')
    })

    it('returns error object when brand not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_brand').handler({ id: 'bad' })
      expect(result).toHaveProperty('error')
    })
  })

  // list_categories returns { categories, count, truncated } — no ok wrapper
  describe('list_categories', () => {
    it('returns categories list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'c1', name: 'Tools' }])
      const result = await getTool('list_categories').handler({})
      expect(Array.isArray(result.categories)).toBe(true)
      expect(result.count).toBe(1)
    })
  })

  // get_category takes { id } — source param is 'id'
  // makes 3 DB calls: queryOne(category) + queryMany(subcategories) + queryOne(productCount)
  // returns raw merged object or { error } — no ok wrapper
  describe('get_category', () => {
    it('returns category by id', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ id: 'c1', name: 'Tools', slug: 'tools' }) // category row
        .mockResolvedValueOnce({ n: 5 })                                   // product count
      mockQueryMany.mockResolvedValueOnce([])                              // subcategories
      const result = await getTool('get_category').handler({ id: 'c1' })
      expect(result).toHaveProperty('id', 'c1')
      expect(result).toHaveProperty('name', 'Tools')
    })

    it('returns error object when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_category').handler({ id: 'bad' })
      expect(result).toHaveProperty('error')
    })
  })

  // list_inventory_low returns { products, threshold, count, truncated } — no ok wrapper
  describe('list_inventory_low', () => {
    it('returns low stock products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Widget', stock: 2 },
      ])
      const result = await getTool('list_inventory_low').handler({})
      expect(Array.isArray(result.products)).toBe(true)
      expect(result.count).toBe(1)
    })

    it('accepts threshold parameter', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_inventory_low').handler({ threshold: 5 })
      expect(Array.isArray(result.products)).toBe(true)
      expect(result.threshold).toBe(5)
    })
  })

  // get_product_full takes { id } — source param is 'id'
  // makes: queryOne(product) + queryMany(variants) + queryMany(subVariants) + queryMany(images)
  // returns raw merged object or { error } — no ok wrapper
  describe('get_product_full', () => {
    it('returns full product data', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        name: 'Widget',
        sku: 'WGT-001',
      })
      // variants (no variant ids → subVariants skipped), images
      mockQueryMany
        .mockResolvedValueOnce([])  // variants — empty so subVariants query is skipped
        .mockResolvedValueOnce([])  // images
      const result = await getTool('get_product_full').handler({ id: 'p1' })
      expect(result).toHaveProperty('id', 'p1')
      expect(result).toHaveProperty('name', 'Widget')
    })

    it('returns error object when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_product_full').handler({ id: 'bad' })
      expect(result).toHaveProperty('error')
    })
  })

  // propose_create_product uses camelCase params: basePrice, brandId, categoryId
  // DB call order: queryOne(existing SKU), queryOne(brand), queryOne(category)
  // returns { proposed, kind, payload, ... } — no ok wrapper
  describe('propose_create_product', () => {
    it('proposes product creation', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)                      // existing SKU check → not found (good)
        .mockResolvedValueOnce({ name: 'Acme' })          // brand lookup
        .mockResolvedValueOnce({ name: 'Tools' })         // category lookup

      const result = await getTool('propose_create_product').handler({
        name: 'New Widget',
        sku: 'NW-001',
        basePrice: 199,
        categoryId: 'c1',
        brandId: 'b1',
      })
      expect(result).toHaveProperty('proposed', true)
      expect(result).toHaveProperty('kind', 'create_product')
    })
  })

  // propose_update_product uses camelCase params: productId, fields (not product_id / updates)
  // throws (not returns { ok: false }) for not-found and invalid fields
  // returns { proposed, kind, payload, ... } on success — no ok wrapper
  describe('propose_update_product', () => {
    it('proposes valid field update', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Old Name', is_active: true })
      const result = await getTool('propose_update_product').handler({
        productId: 'p1',
        fields: { name: 'New Name', base_price: 299 },
      })
      expect(result).toHaveProperty('proposed', true)
    })

    it('rejects invalid field updates (unknown fields → no changes → proposed false)', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Old Name', is_active: true })
      const result = await getTool('propose_update_product').handler({
        productId: 'p1',
        fields: { secret_field: 'hack' },
      })
      // Unknown fields are silently skipped → 0 changes → proposed: false
      expect(result).toHaveProperty('proposed', false)
    })

    it('throws when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_update_product').handler({
          productId: 'bad',
          fields: { name: 'X' },
        })
      ).rejects.toThrow('Product not found')
    })
  })

  // propose_adjust_inventory uses camelCase: productId, delta (not product_id / adjustment)
  // throws on not-found — no ok wrapper on success
  describe('propose_adjust_inventory', () => {
    it('proposes inventory adjustment', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', sku: 'W-001', inventory_quantity: 10, has_variants: false })
      const result = await getTool('propose_adjust_inventory').handler({
        productId: 'p1',
        delta: 5,
        reason: 'restocked',
      })
      expect(result).toHaveProperty('proposed', true)
      expect(result).toHaveProperty('kind', 'adjust_inventory')
    })

    it('throws when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_adjust_inventory').handler({
          productId: 'bad',
          delta: 5,
          reason: 'test',
        })
      ).rejects.toThrow('Product not found')
    })
  })

  // propose_set_product_featured uses camelCase: productId, featured
  // DB calls: queryOne(product), then query() (raw, not queryOne) for count when featuring
  // throws on not-found — no ok wrapper on success
  describe('propose_set_product_featured', () => {
    it('proposes featuring product when below limit', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', is_featured: false })
      // source uses queryOne for the count check (SELECT COUNT(*) AS n)
      mockQueryOne.mockResolvedValueOnce({ n: 3 })

      const result = await getTool('propose_set_product_featured').handler({
        productId: 'p1',
        featured: true,
      })
      expect(result).toHaveProperty('proposed', true)
    })

    it('still proposes (with warning block) when at FEATURED_LIMIT (6)', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', is_featured: false })
      mockQueryOne.mockResolvedValueOnce({ n: 6 })

      const result = await getTool('propose_set_product_featured').handler({
        productId: 'p1',
        featured: true,
      })
      // Source still returns { proposed: true } even at limit (adds a callout block)
      expect(result).toHaveProperty('proposed', true)
    })

    it('proposes unfeaturing without limit check', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', is_featured: true })
      // When unfeaturing, source still calls queryOne for count
      mockQueryOne.mockResolvedValueOnce({ n: 4 })
      const result = await getTool('propose_set_product_featured').handler({
        productId: 'p1',
        featured: false,
      })
      expect(result).toHaveProperty('proposed', true)
    })
  })

  // propose_create_brand returns { proposed, kind, payload, ... } — no ok wrapper, no 'action' key
  // calls queryOne once for duplicate-slug/name check
  describe('propose_create_brand', () => {
    it('proposes brand creation', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // no conflict
      const result = await getTool('propose_create_brand').handler({
        name: 'New Brand',
      })
      expect(result).toHaveProperty('proposed', true)
      expect(result).toHaveProperty('kind', 'create_brand')
    })

    it('slugifies brand name', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // no conflict
      const result = await getTool('propose_create_brand').handler({
        name: 'My  New  Brand!',
      })
      expect(result).toHaveProperty('proposed', true)
      const payload = (result as any).payload
      expect(payload?.slug).toMatch(/^[a-z0-9-]+$/)
    })
  })

  // propose_create_category returns { proposed, kind, payload, ... } — no ok wrapper
  // without parentId: calls queryOne once (slug conflict check)
  // with parentId: calls queryOne(parent) then queryOne(slug conflict)
  describe('propose_create_category', () => {
    it('proposes category creation', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // slug conflict check → none
      const result = await getTool('propose_create_category').handler({
        name: 'Power Tools',
      })
      expect(result).toHaveProperty('proposed', true)
      expect(result).toHaveProperty('kind', 'create_category')
    })

    it('accepts optional parentId', async () => {
      // source param is 'parentId' (camelCase), not 'parent_category_id'
      mockQueryOne
        .mockResolvedValueOnce({ id: 'c1', name: 'Tools', parent_name: null }) // parent lookup
        .mockResolvedValueOnce(null)                                            // slug conflict → none
      const result = await getTool('propose_create_category').handler({
        name: 'Drills',
        parentId: 'c1',
      })
      expect(result).toHaveProperty('proposed', true)
    })
  })
})
