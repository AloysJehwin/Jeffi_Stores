import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '(SELECT MIN(price) FROM product_variants WHERE product_id = p.id)',
  EFFECTIVE_STOCK_SQL: 'COALESCE(stock, 0)',
}))
vi.mock('@/lib/shared/rag', () => ({
  embed: vi.fn(),
  findSimilarProductIds: vi.fn(),
}))

import { CUSTOMER_TOOLS, getCustomerTool } from '@/lib/customer-agent/tools'
import * as db from '@/lib/shared/db'
import * as rag from '@/lib/shared/rag'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockFindSimilar = vi.mocked(rag.findSimilarProductIds)
const mockEmbed = vi.mocked(rag.embed)

const ctx = { authenticatedUserId: 'user-123' }

describe('customer-agent/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('CUSTOMER_TOOLS array', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(CUSTOMER_TOOLS)).toBe(true)
      expect(CUSTOMER_TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of CUSTOMER_TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  describe('getCustomerTool', () => {
    it('returns tool by name', () => {
      const first = CUSTOMER_TOOLS[0]
      expect(getCustomerTool(first.name)?.name).toBe(first.name)
    })

    it('returns null for unknown tool', () => {
      expect(getCustomerTool('nonexistent_xyz')).toBeNull()
    })
  })

  describe('search_products', () => {
    const tool = () => getCustomerTool('search_products')!

    it('returns product search results via embedding (products match)', async () => {
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 },
        { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      ])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Widget A', slug: 'widget-a', sku: 'WA1', price: '199', short_description: null, stock: 5 },
        { id: 'p2', name: 'Widget B', slug: 'widget-b', sku: 'WB1', price: '299', short_description: null, stock: 3 },
      ])

      const result = await tool().handler({ query: 'blue widget' }, ctx)
      expect((result as any).products).toBeDefined()
      expect((result as any).products).toHaveLength(2)
    })

    it('resolves variant matches to product ids', async () => {
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'product_variants', productId: '', variantId: 'v1', similarity: 0.9 },
      ])
      // variant -> product lookup
      mockQueryMany
        .mockResolvedValueOnce([{ product_id: 'p3' }])
        // product details
        .mockResolvedValueOnce([
          { id: 'p3', name: 'Gizmo', slug: 'gizmo', sku: 'G1', price: '150', short_description: null, stock: 2 },
        ])
      const result = await tool().handler({ query: 'gizmo variant' }, ctx)
      expect((result as any).products).toHaveLength(1)
    })

    it('returns empty results when no similar products found', async () => {
      mockFindSimilar.mockResolvedValueOnce([])
      // vector path empty -> keyword/pg_trgm fallback runs and also finds nothing
      mockQueryMany.mockResolvedValueOnce([])

      const result = await tool().handler({ query: 'unknown item' }, ctx)
      expect((result as any).products).toHaveLength(0)
    })

    it('returns empty products when query is missing', async () => {
      mockFindSimilar.mockResolvedValueOnce([])
      mockQueryMany.mockResolvedValueOnce([]) // fallback keyword search
      const result = await tool().handler({}, ctx)
      expect((result as any).products).toBeDefined()
    })

    it('respects custom limit and clamps within range', async () => {
      mockFindSimilar.mockResolvedValueOnce([])
      mockQueryMany.mockResolvedValueOnce([]) // fallback keyword search
      await tool().handler({ query: 'test', limit: 3 }, ctx)
      expect(mockFindSimilar).toHaveBeenCalledWith(expect.any(String), 9) // lim * 3
    })
  })

  describe('get_product', () => {
    const tool = () => getCustomerTool('get_product')!

    it('throws when neither id nor slug provided', async () => {
      await expect(tool().handler({}, ctx)).rejects.toThrow('Provide id or slug')
    })

    it('returns product by slug', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        name: 'Test Widget',
        slug: 'test-widget',
        price: '299',
        stock: 10,
      })

      const result = await tool().handler({ slug: 'test-widget' }, ctx)
      expect((result as any).id).toBe('p1')
    })

    it('returns product by id', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        name: 'Test Widget',
        slug: 'test-widget',
        price: '299',
        stock: 10,
      })
      const result = await tool().handler({ id: 'p1' }, ctx)
      expect((result as any).name).toBe('Test Widget')
    })

    it('returns error object when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ slug: 'nonexistent' }, ctx)
      expect((result as any).error).toBe('Product not found')
    })
  })

  describe('find_similar_products', () => {
    const tool = () => getCustomerTool('find_similar_products')!

    it('returns note when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ productId: 'p-ghost' }, ctx)
      expect((result as any).products).toHaveLength(0)
      expect((result as any).note).toBeDefined()
    })

    it('returns empty products when no similar ids found', async () => {
      mockQueryOne.mockResolvedValueOnce({ name: 'Widget' })
      mockFindSimilar.mockResolvedValueOnce([])
      mockQueryMany.mockResolvedValueOnce([]) // fallback keyword search finds nothing
      const result = await tool().handler({ productId: 'p1' }, ctx)
      expect((result as any).products).toHaveLength(0)
    })

    it('excludes the source product from similar results', async () => {
      mockQueryOne.mockResolvedValueOnce({ name: 'Widget A' })
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 }, // same as source, should be excluded
        { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      ])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p2', name: 'Widget B', slug: 'widget-b', sku: 'WB1', price: '299', stock: 5 },
      ])
      const result = await tool().handler({ productId: 'p1', limit: 5 }, ctx)
      expect((result as any).products).toHaveLength(1)
      expect((result as any).products[0].id).toBe('p2')
    })

    it('returns products when similar products found', async () => {
      mockQueryOne.mockResolvedValueOnce({ name: 'Widget A' })
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.9 },
        { matchedVia: 'products', productId: 'p3', variantId: null, similarity: 0.8 },
      ])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p2', name: 'Widget B', slug: 'widget-b', sku: 'WB1', price: '299', stock: 5 },
        { id: 'p3', name: 'Widget C', slug: 'widget-c', sku: 'WC1', price: '349', stock: 8 },
      ])
      const result = await tool().handler({ productId: 'p1', limit: 5 }, ctx)
      expect((result as any).products).toHaveLength(2)
    })
  })

  describe('get_recent_products', () => {
    const tool = () => getCustomerTool('get_recent_products')!

    it('returns recently added products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        {
          id: 'p1',
          name: 'New Product',
          slug: 'new-product',
          sku: 'NP1',
          price: '299',
          short_description: 'A new one',
        },
        { id: 'p2', name: 'Another New', slug: 'another-new', sku: 'AN1', price: '199', short_description: null },
      ])
      const result = await tool().handler({}, ctx)
      expect((result as any).products).toHaveLength(2)
    })

    it('returns empty array when no recent products', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ limit: 5 }, ctx)
      expect((result as any).products).toHaveLength(0)
    })

    it('respects custom limit', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ limit: 3 }, ctx)
      expect(mockQueryMany.mock.calls[0][1]).toContain(3)
    })

    it('clamps limit to max of 10', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ limit: 100 }, ctx)
      const passedLimit = (mockQueryMany.mock.calls[0][1] as unknown[])[0]
      expect(passedLimit).toBe(10)
    })
  })

  describe('get_featured_products', () => {
    const tool = () => getCustomerTool('get_featured_products')!

    it('returns featured products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        {
          id: 'p1',
          name: 'Featured Widget',
          slug: 'featured-widget',
          sku: 'FW1',
          price: '499',
          short_description: 'Great pick',
        },
      ])
      const result = await tool().handler({}, ctx)
      expect((result as any).products).toHaveLength(1)
    })

    it('returns empty array when no featured products', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ limit: 5 }, ctx)
      expect((result as any).products).toHaveLength(0)
    })

    it('clamps limit to valid range', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ limit: 0 }, ctx)
      const passedLimit = (mockQueryMany.mock.calls[0][1] as unknown[])[0]
      expect(passedLimit).toBeGreaterThanOrEqual(1)
    })
  })

  describe('get_my_orders', () => {
    const tool = () => getCustomerTool('get_my_orders')!

    it('returns orders for authenticated user', async () => {
      mockQueryMany.mockResolvedValueOnce([
        {
          id: 'o1',
          order_number: 'ORD-001',
          status: 'delivered',
          payment_status: 'paid',
          total_amount: '1500',
          created_at: '2024-01-01',
          delivered_at: null,
          awb_number: null,
        },
        {
          id: 'o2',
          order_number: 'ORD-002',
          status: 'processing',
          payment_status: 'paid',
          total_amount: '800',
          created_at: '2024-02-01',
          delivered_at: null,
          awb_number: null,
        },
      ])

      const result = await tool().handler({}, ctx)
      expect((result as any).orders).toBeDefined()
      expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['user-123']))
    })

    it('returns empty list when user has no orders', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({}, ctx)
      expect((result as any).orders).toBeDefined()
      expect((result as any).orders).toHaveLength(0)
    })

    it('enforces user ownership via authenticatedUserId in WHERE', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({}, ctx)
      const callArgs = mockQueryMany.mock.calls[0]
      expect(callArgs[1]).toContain('user-123')
    })

    it('applies status filter when provided', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ status: 'delivered' }, ctx)
      const params = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(params).toContain('delivered')
    })

    it('respects custom limit', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ limit: 10 }, ctx)
      const params = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(params).toContain(10)
    })
  })

  describe('get_my_order', () => {
    const tool = () => getCustomerTool('get_my_order')!

    it('returns specific order with line items for authenticated user', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1',
        order_number: 'ORD-001',
        status: 'delivered',
        payment_status: 'paid',
        subtotal: '1400',
        total_amount: '1500',
        created_at: '2024-01-01',
        delivered_at: '2024-01-05',
      })
      mockQueryMany.mockResolvedValueOnce([
        {
          product_name: 'Widget A',
          product_sku: 'WA1',
          variant_name: null,
          quantity: '2',
          unit_price: '700',
          total_price: '1400',
        },
      ])

      const result = await tool().handler({ orderNumber: 'ORD-001' }, ctx)
      expect((result as any).id).toBe('o1')
      expect((result as any).items).toHaveLength(1)
    })

    it('returns error when order not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ orderNumber: 'nonexistent' }, ctx)
      expect((result as any).error).toBeDefined()
    })

    it('enforces user ownership via authenticatedUserId in WHERE clause', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await tool().handler({ orderNumber: 'ORD-001' }, ctx)
      const callArgs = mockQueryOne.mock.calls[0]
      expect(callArgs[1]).toContain('user-123')
    })

    it('returns order with empty items array when no line items', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o2',
        order_number: 'ORD-002',
        status: 'processing',
        payment_status: 'paid',
        subtotal: '500',
        total_amount: '520',
        created_at: '2024-03-01',
        delivered_at: null,
      })
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ orderNumber: 'ORD-002' }, ctx)
      expect((result as any).items).toHaveLength(0)
    })
  })

  describe('get_my_recommendations', () => {
    const tool = () => getCustomerTool('get_my_recommendations')!

    it('returns note and empty products when user has no purchase history', async () => {
      mockQueryMany.mockResolvedValueOnce([]) // no recent items
      const result = await tool().handler({}, ctx)
      expect((result as any).products).toHaveLength(0)
      expect((result as any).note).toMatch(/No purchase history/)
    })

    it('uses purchase history to find similar products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { product_id: 'p1', product_name: 'Widget A' },
        { product_id: 'p2', product_name: 'Widget B' },
      ])
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'products', productId: 'p3', variantId: null, similarity: 0.9 },
        { matchedVia: 'products', productId: 'p4', variantId: null, similarity: 0.8 },
      ])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p3', name: 'Similar C', slug: 'similar-c', sku: 'SC1', price: '299', short_description: null },
        { id: 'p4', name: 'Similar D', slug: 'similar-d', sku: 'SD1', price: '349', short_description: null },
      ])
      const result = await tool().handler({ limit: 5 }, ctx)
      expect((result as any).products).toHaveLength(2)
    })

    it('excludes already-owned products from recommendations', async () => {
      mockQueryMany.mockResolvedValueOnce([{ product_id: 'p1', product_name: 'Widget A' }])
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 }, // already owned — excluded
        { matchedVia: 'products', productId: 'p2', variantId: null, similarity: 0.8 },
      ])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p2', name: 'Widget B', slug: 'widget-b', sku: 'WB1', price: '199', short_description: null },
      ])
      const result = await tool().handler({}, ctx)
      const products = (result as any).products as { id: string }[]
      expect(products.every(p => p.id !== 'p1')).toBe(true)
    })

    it('returns empty products when all similar ids are already owned', async () => {
      mockQueryMany.mockResolvedValueOnce([{ product_id: 'p1', product_name: 'Widget A' }])
      mockFindSimilar.mockResolvedValueOnce([
        { matchedVia: 'products', productId: 'p1', variantId: null, similarity: 0.9 }, // only result, already owned
      ])
      const result = await tool().handler({}, ctx)
      expect((result as any).products).toHaveLength(0)
    })

    it('passes authenticatedUserId for ownership lookup', async () => {
      mockQueryMany.mockResolvedValueOnce([]) // no history
      await tool().handler({}, ctx)
      expect(mockQueryMany.mock.calls[0][1]).toContain('user-123')
    })
  })
})
