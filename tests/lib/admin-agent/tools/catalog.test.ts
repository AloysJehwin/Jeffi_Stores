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
      const result = await getTool('list_featured_products').handler({}) as any
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
      const result = await getTool('list_brands').handler({}) as any
      expect(Array.isArray(result.brands)).toBe(true)
      expect(result.count).toBe(2)
    })
  })

  // get_brand takes { id } — source param is 'id', not 'brand_id'
  // returns raw row or { error } — no ok wrapper
  describe('get_brand', () => {
    it('returns brand by id', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'b1', name: 'Acme' })
      const result = await getTool('get_brand').handler({ id: 'b1' }) as any
      expect(result).toHaveProperty('id', 'b1')
      expect(result).toHaveProperty('name', 'Acme')
    })

    it('returns error object when brand not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_brand').handler({ id: 'bad' }) as any
      expect(result).toHaveProperty('error')
    })
  })

  // list_categories returns { categories, count, truncated } — no ok wrapper
  describe('list_categories', () => {
    it('returns categories list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'c1', name: 'Tools' }])
      const result = await getTool('list_categories').handler({}) as any
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
      const result = await getTool('get_category').handler({ id: 'c1' }) as any
      expect(result).toHaveProperty('id', 'c1')
      expect(result).toHaveProperty('name', 'Tools')
    })

    it('returns error object when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_category').handler({ id: 'bad' }) as any
      expect(result).toHaveProperty('error')
    })
  })

  // list_inventory_low returns { products, threshold, count, truncated } — no ok wrapper
  describe('list_inventory_low', () => {
    it('returns low stock products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Widget', stock: 2 },
      ])
      const result = await getTool('list_inventory_low').handler({}) as any
      expect(Array.isArray(result.products)).toBe(true)
      expect(result.count).toBe(1)
    })

    it('accepts threshold parameter', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_inventory_low').handler({ threshold: 5 }) as any
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

    // Line 449: newStock < 0 — negative stock callout
    it('includes negative-stock error callout when delta would make stock negative', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', sku: 'W-001', inventory_quantity: 3, has_variants: false })
      const result = await getTool('propose_adjust_inventory').handler({
        productId: 'p1',
        delta: -10,
        reason: 'write-off',
      })
      expect(result).toHaveProperty('proposed', true)
      const blocks = (result as any).ui_blocks as any[]
      const errBlock = blocks.find((b: any) => b.tone === 'error')
      expect(errBlock).toBeDefined()
      expect(errBlock.title).toContain('Negative stock')
    })

    // Line 448: p.has_variants — variants info callout
    it('includes has-variants info callout when product has variants', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Multi', sku: 'M-001', inventory_quantity: 20, has_variants: true })
      const result = await getTool('propose_adjust_inventory').handler({
        productId: 'p1',
        delta: 5,
        reason: 'stock top-up',
      })
      expect(result).toHaveProperty('proposed', true)
      const blocks = (result as any).ui_blocks as any[]
      const infoBlock = blocks.find((b: any) => b.tone === 'info')
      expect(infoBlock).toBeDefined()
      expect(infoBlock.title).toContain('variants')
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

    // Line 485: p.is_featured === target — no-op branch
    it('returns proposed false when product is already featured and target is featured', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', is_featured: true })
      const result = await getTool('propose_set_product_featured').handler({
        productId: 'p1',
        featured: true,
      })
      expect(result).toHaveProperty('proposed', false)
      expect((result as any).info).toContain('already featured')
    })

    it('returns proposed false when product is already not featured and target is not featured', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', is_featured: false })
      const result = await getTool('propose_set_product_featured').handler({
        productId: 'p1',
        featured: false,
      })
      expect(result).toHaveProperty('proposed', false)
      expect((result as any).info).toContain('not featured')
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

    // Line 557: conflict truthy — duplicate callout added
    it('still proposes but adds a duplicate-warning callout when slug/name conflicts', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'b99', name: 'Existing Brand' }) // conflict found
      const result = await getTool('propose_create_brand').handler({
        name: 'Existing Brand',
      })
      // Source still sets proposed: true and adds a warn callout block
      expect(result).toHaveProperty('proposed', true)
      const blocks = (result as any).ui_blocks as any[]
      const warnBlock = blocks.find((b: any) => b.tone === 'warn')
      expect(warnBlock).toBeDefined()
      expect(warnBlock.title).toContain('duplicate')
    })

    it('throws when logoUrl is not an http(s) URL', async () => {
      await expect(
        getTool('propose_create_brand').handler({
          name: 'Brand',
          logoUrl: 'ftp://bad.url/logo.png',
        })
      ).rejects.toThrow('logoUrl must be http(s) URL')
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

    // Line 617: conflict truthy — slug-in-use callout added
    it('still proposes but adds slug-in-use warn callout when slug conflicts', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // no conflict on slug without parentId path
      // Re-mock: actually the conflict check is the only queryOne for no-parent case
      // Reset and set conflict
      vi.resetAllMocks()
      mockQueryOne.mockResolvedValueOnce({ id: 'c99', name: 'Existing Category' }) // conflict
      const result = await getTool('propose_create_category').handler({
        name: 'Power Tools',
        slug: 'power-tools',
      })
      expect(result).toHaveProperty('proposed', true)
      const blocks = (result as any).ui_blocks as any[]
      const warnBlock = blocks.find((b: any) => b.tone === 'warn')
      expect(warnBlock).toBeDefined()
      expect(warnBlock.title).toContain('Slug')
    })

    it('throws when parent category not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // parent lookup → not found
      await expect(
        getTool('propose_create_category').handler({
          name: 'Drills',
          parentId: 'nonexistent-uuid',
        })
      ).rejects.toThrow('Parent category not found')
    })

    it('builds nested path label from grandparent when parent has a parent_name', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ id: 'c2', name: 'Hand Tools', parent_name: 'Hardware' }) // parent has grandparent
        .mockResolvedValueOnce(null) // slug conflict → none
      const result = await getTool('propose_create_category').handler({
        name: 'Hammers',
        parentId: 'c2',
      })
      expect(result).toHaveProperty('proposed', true)
      // pathLabel should be "Hardware / Hand Tools / Hammers"
      expect((result as any).payload.pathLabel).toBe('Hardware / Hand Tools / Hammers')
    })
  })

  // ---- list_featured_products: empty result / edge cases ----
  describe('list_featured_products — edge cases', () => {
    it('returns empty summary when no featured products', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_featured_products').handler({}) as any
      expect(result.ok).toBe(true)
      expect(result.summary).toMatch(/no products/i)
      expect(result.count).toBe(0)
    })

    it('includes out-of-stock count in summary when some are out of stock', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Widget A', stock: 5 },
        { id: 'p2', name: 'Widget B', stock: 0 },
      ])
      const result = await getTool('list_featured_products').handler({}) as any
      expect(result.ok).toBe(true)
      expect(result.summary).toContain('1 out')
    })

    it('respects activeOnly=false parameter', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'Inactive Widget', stock: 3 }])
      const result = await getTool('list_featured_products').handler({ activeOnly: false }) as any
      expect(result.ok).toBe(true)
      expect(result.count).toBe(1)
    })
  })

  // ---- list_brands: edge cases ----
  describe('list_brands — edge cases', () => {
    it('returns empty brands array', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_brands').handler({}) as any
      expect(result.brands).toEqual([])
      expect(result.count).toBe(0)
    })

    it('respects activeOnly=false', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'b1', name: 'Old Brand', is_active: false }])
      const result = await getTool('list_brands').handler({ activeOnly: false }) as any
      expect(result.count).toBe(1)
    })

    it('sets truncated=true when count equals limit', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({ id: `b${i}` }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('list_brands').handler({ limit: 50 }) as any
      expect(result.truncated).toBe(true)
    })
  })

  // ---- list_categories: edge cases ----
  describe('list_categories — edge cases', () => {
    it('returns empty categories array', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_categories').handler({}) as any
      expect(result.categories).toEqual([])
      expect(result.count).toBe(0)
    })

    it('applies parentOnly=true filter', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'c1', name: 'Top Level' }])
      const result = await getTool('list_categories').handler({ parentOnly: true }) as any
      expect(result.count).toBe(1)
    })

    it('sets truncated=true when count equals limit', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('list_categories').handler({ limit: 100 }) as any
      expect(result.truncated).toBe(true)
    })
  })

  // ---- get_product_full: with variants ----
  describe('get_product_full — with variants', () => {
    it('returns product with variants and sub-variants', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Multi Widget', sku: 'MW-001' })
      mockQueryMany
        .mockResolvedValueOnce([{ id: 'v1', variant_name: 'Red' }])
        .mockResolvedValueOnce([{ id: 'sv1', sub_variant_name: 'S' }])
        .mockResolvedValueOnce([{ id: 'img1', image_url: 'http://img.com/a.jpg' }])
      const result = await getTool('get_product_full').handler({ id: 'p1' }) as any
      expect(result.variants).toHaveLength(1)
      expect(result.sub_variants).toHaveLength(1)
      expect(result.images).toHaveLength(1)
    })
  })

  // ---- list_inventory_low: edge cases ----
  describe('list_inventory_low — edge cases', () => {
    it('returns empty products when nothing is low-stock', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_inventory_low').handler({ threshold: 0 }) as any
      expect(result.products).toEqual([])
      expect(result.threshold).toBe(0)
    })

    it('clamps threshold to 0 minimum', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_inventory_low').handler({ threshold: -5 }) as any
      expect(result.threshold).toBe(0)
    })

    it('clamps threshold to 1000 maximum', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_inventory_low').handler({ threshold: 9999 }) as any
      expect(result.threshold).toBe(1000)
    })

    it('sets truncated=true when count equals limit', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, stock: 0 }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('list_inventory_low').handler({ limit: 50 }) as any
      expect(result.truncated).toBe(true)
    })
  })

  // ---- propose_create_product: error branches ----
  describe('propose_create_product — error branches', () => {
    it('throws when name is empty', async () => {
      await expect(
        getTool('propose_create_product').handler({ name: '', sku: 'X-001', basePrice: 100 })
      ).rejects.toThrow(/name required/i)
    })

    it('throws when name exceeds 255 chars', async () => {
      await expect(
        getTool('propose_create_product').handler({ name: 'A'.repeat(256), sku: 'X-001', basePrice: 100 })
      ).rejects.toThrow(/name required/i)
    })

    it('throws when sku is empty', async () => {
      await expect(
        getTool('propose_create_product').handler({ name: 'Widget', sku: '', basePrice: 100 })
      ).rejects.toThrow(/sku required/i)
    })

    it('throws when basePrice is negative', async () => {
      await expect(
        getTool('propose_create_product').handler({ name: 'Widget', sku: 'W-001', basePrice: -1 })
      ).rejects.toThrow(/basePrice/i)
    })

    it('throws when brandId does not exist', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)  // existing SKU check
        .mockResolvedValueOnce(null)  // brand not found
      await expect(
        getTool('propose_create_product').handler({ name: 'Widget', sku: 'W-001', basePrice: 100, brandId: 'bad-brand' })
      ).rejects.toThrow(/brand not found/i)
    })

    it('throws when categoryId does not exist', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)              // existing SKU check
        .mockResolvedValueOnce({ name: 'Acme' }) // brand found
        .mockResolvedValueOnce(null)              // category not found
      await expect(
        getTool('propose_create_product').handler({ name: 'Widget', sku: 'W-001', basePrice: 100, brandId: 'b1', categoryId: 'bad-cat' })
      ).rejects.toThrow(/category not found/i)
    })

    it('adds SKU-already-exists warn callout when SKU is a duplicate', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-p', name: 'Old Widget' })
      const result = await getTool('propose_create_product').handler({
        name: 'New Widget', sku: 'DUP-001', basePrice: 99,
      }) as any
      expect(result.proposed).toBe(true)
      const warnBlock = result.ui_blocks.find((b: any) => b.tone === 'warn')
      expect(warnBlock).toBeDefined()
      expect(warnBlock.title).toMatch(/SKU already exists/i)
    })
  })

  // ---- propose_update_product: field validation branches ----
  describe('propose_update_product — field validation branches', () => {
    it('throws when name is set to empty string', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', base_price: '100', is_active: true, is_featured: false })
      await expect(
        getTool('propose_update_product').handler({ productId: 'p1', fields: { name: '' } })
      ).rejects.toThrow(/name/i)
    })

    it('throws when base_price is set to negative', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', base_price: '100', is_active: true })
      await expect(
        getTool('propose_update_product').handler({ productId: 'p1', fields: { base_price: -5 } })
      ).rejects.toThrow(/base_price/i)
    })

    it('throws when gst_percentage is out of range', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', gst_percentage: '18' })
      await expect(
        getTool('propose_update_product').handler({ productId: 'p1', fields: { gst_percentage: 99 } })
      ).rejects.toThrow(/gst_percentage/i)
    })

    it('throws when brand_id is invalid', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ id: 'p1', name: 'Widget', brand_id: null, category_id: null, gst_percentage: '18', base_price: '100', is_active: true, is_featured: false, short_description: null })
        .mockResolvedValueOnce(null) // brand not found
      await expect(
        getTool('propose_update_product').handler({ productId: 'p1', fields: { brand_id: 'bad-brand-uuid' } })
      ).rejects.toThrow(/brand not found/i)
    })

    it('throws when category_id is invalid', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ id: 'p1', name: 'Widget', brand_id: null, category_id: null, gst_percentage: '18', base_price: '100', is_active: true, is_featured: false, short_description: null })
        .mockResolvedValueOnce(null) // category not found
      await expect(
        getTool('propose_update_product').handler({ productId: 'p1', fields: { category_id: 'bad-cat-uuid' } })
      ).rejects.toThrow(/category not found/i)
    })

    it('adds is_active=false warning callout', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', base_price: '100', is_active: true, is_featured: false, brand_id: null, category_id: null, gst_percentage: '18', short_description: null })
      const result = await getTool('propose_update_product').handler({
        productId: 'p1', fields: { is_active: false },
      }) as any
      expect(result.proposed).toBe(true)
      const warnBlock = result.ui_blocks.find((b: any) => b.tone === 'warn')
      expect(warnBlock).toBeDefined()
      expect(warnBlock.title).toMatch(/hidden/i)
    })

    it('throws when short_description exceeds 500 chars', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Widget', base_price: '100', is_active: true, short_description: null })
      await expect(
        getTool('propose_update_product').handler({ productId: 'p1', fields: { short_description: 'X'.repeat(501) } })
      ).rejects.toThrow(/short_description/i)
    })
  })

  // ---- propose_adjust_inventory: input validation ----
  describe('propose_adjust_inventory — input validation', () => {
    it('throws when delta is 0', async () => {
      await expect(
        getTool('propose_adjust_inventory').handler({ productId: 'p1', delta: 0, reason: 'test' })
      ).rejects.toThrow(/non-zero integer/i)
    })

    it('throws when delta is a float', async () => {
      await expect(
        getTool('propose_adjust_inventory').handler({ productId: 'p1', delta: 1.5, reason: 'test' })
      ).rejects.toThrow(/non-zero integer/i)
    })

    it('throws when |delta| > 100000', async () => {
      await expect(
        getTool('propose_adjust_inventory').handler({ productId: 'p1', delta: 200000, reason: 'test' })
      ).rejects.toThrow(/too large/i)
    })

    it('throws when reason is empty', async () => {
      await expect(
        getTool('propose_adjust_inventory').handler({ productId: 'p1', delta: 5, reason: '' })
      ).rejects.toThrow(/reason required/i)
    })

    it('throws when reason exceeds 200 chars', async () => {
      await expect(
        getTool('propose_adjust_inventory').handler({ productId: 'p1', delta: 5, reason: 'X'.repeat(201) })
      ).rejects.toThrow(/reason required/i)
    })
  })

  // ---- propose_create_brand: validation ----
  describe('propose_create_brand — validation', () => {
    it('throws when name is empty', async () => {
      await expect(getTool('propose_create_brand').handler({ name: '' })).rejects.toThrow(/name required/i)
    })

    it('throws when name exceeds 100 chars', async () => {
      await expect(getTool('propose_create_brand').handler({ name: 'A'.repeat(101) })).rejects.toThrow(/name required/i)
    })

    it('accepts valid https logoUrl', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_brand').handler({
        name: 'Good Brand', logoUrl: 'https://cdn.example.com/logo.png',
      }) as any
      expect(result.proposed).toBe(true)
      expect(result.payload.logoUrl).toBe('https://cdn.example.com/logo.png')
    })
  })
})
