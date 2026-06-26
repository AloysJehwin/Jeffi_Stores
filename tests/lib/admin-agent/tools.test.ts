import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockPgClient = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}))

const mockPgPool = vi.hoisted(() => ({
  connect: vi.fn(),
  on: vi.fn(),
}))

// Mock node:fs/promises so list_repo_files, read_repo_file, list_admin_api_routes
// do not touch the real filesystem
const mockFs = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  open: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('node:fs/promises', () => mockFs)

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/rag', () => ({
  embed: vi.fn(),
  findSimilarProductIds: vi.fn(),
  findSimilarCustomers: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '(SELECT MIN(price) FROM product_variants WHERE product_id = p.id)',
  EFFECTIVE_STOCK_SQL: 'COALESCE(stock, 0)',
}))
vi.mock('pg', () => {
  function Pool(this: any) {
    this.connect = mockPgPool.connect
    this.on = mockPgPool.on
  }
  return { default: { Pool }, Pool }
})

import { TOOLS, getTool } from '@/lib/admin-agent/tools'
import * as db from '@/lib/db'
import * as rag from '@/lib/rag'

const mockQuery = vi.mocked(db.query)
const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockEmbed = vi.mocked(rag.embed)
const mockFindSimilarCustomers = vi.mocked(rag.findSimilarCustomers)

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('admin-agent/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPgPool.connect.mockResolvedValue(mockPgClient)
  })

  describe('TOOLS array', () => {
    it('exports a non-empty array of tools', () => {
      expect(Array.isArray(TOOLS)).toBe(true)
      expect(TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
        expect(tool).toHaveProperty('inputSchema')
      }
    })
  })

  describe('getTool', () => {
    it('returns tool by name', () => {
      const first = TOOLS[0]
      const found = getTool(first.name)
      expect(found).toBeDefined()
      expect(found?.name).toBe(first.name)
    })

    it('returns undefined for unknown tool', () => {
      expect(getTool('nonexistent_tool_xyz')).toBeNull()
    })
  })

  describe('search_products', () => {
    const tool = () => getTool('search_products')!

    it('returns empty result when no embeddings found', async () => {
      mockEmbed.mockResolvedValueOnce([0.1, 0.2])
      mockQueryMany.mockResolvedValueOnce([]) // no embedding rows
      const result = await tool().handler({ query: 'nonexistent thing' })
      expect((result as any).ok).toBe(true)
      expect((result as any).data.products).toHaveLength(0)
    })

    it('returns products matched via products table', async () => {
      mockEmbed.mockResolvedValueOnce([0.1, 0.2])
      // embedding search returns product rows
      mockQueryMany
        .mockResolvedValueOnce([
          { source_table: 'products', source_id: 'p1', sim: 0.9 },
          { source_table: 'products', source_id: 'p2', sim: 0.8 },
        ])
        // product details query
        .mockResolvedValueOnce([
          { id: 'p1', name: 'Widget A', slug: 'widget-a', sku: 'WA1', price: 100, stock: 5, brand: 'BrandX', category: 'Cat1' },
          { id: 'p2', name: 'Widget B', slug: 'widget-b', sku: 'WB1', price: 200, stock: 10, brand: 'BrandX', category: 'Cat1' },
        ])
      const result = await tool().handler({ query: 'widget', limit: 10 })
      expect((result as any).ok).toBe(true)
      expect((result as any).data.products.length).toBeGreaterThan(0)
    })

    it('resolves variant source_ids to product ids', async () => {
      mockEmbed.mockResolvedValueOnce([0.1, 0.2])
      // embedding search returns variant rows
      mockQueryMany
        .mockResolvedValueOnce([
          { source_table: 'product_variants', source_id: 'v1', sim: 0.85 },
        ])
        // variant -> product lookup
        .mockResolvedValueOnce([{ product_id: 'p3' }])
        // product details
        .mockResolvedValueOnce([
          { id: 'p3', name: 'Gizmo', slug: 'gizmo', sku: 'G1', price: 150, stock: 2, brand: null, category: null },
        ])
      const result = await tool().handler({ query: 'gizmo' })
      expect((result as any).ok).toBe(true)
    })

    it('clamps limit to valid range', async () => {
      mockEmbed.mockResolvedValueOnce([0.1])
      mockQueryMany.mockResolvedValueOnce([])
      // limit 0 should be clamped to 1 (no throw)
      await expect(tool().handler({ query: 'test', limit: 0 })).resolves.toBeDefined()
    })
  })

  describe('get_product', () => {
    const tool = () => getTool('get_product')!

    it('throws when neither id nor slug provided', async () => {
      await expect(tool().handler({})).rejects.toThrow('Provide id or slug')
    })

    it('returns product when found by id', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Test', slug: 'test', price: '100', stock: 5 })
      const result = await tool().handler({ id: 'p1' })
      expect((result as any).id).toBe('p1')
    })

    it('returns product when found by slug', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', name: 'Test', slug: 'test', price: '100', stock: 5 })
      const result = await tool().handler({ slug: 'test' })
      expect((result as any).name).toBe('Test')
    })

    it('returns error object when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ slug: 'missing' })
      expect((result as any).error).toBe('Product not found')
    })
  })

  describe('get_product_variants', () => {
    const tool = () => getTool('get_product_variants')!

    it('returns variants for a product', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'v1', variant_name: 'Red/M', sku: 'P1-R-M', price: '299', mrp: '350', stock_status: 'in_stock', inventory_quantity: 10, is_active: true },
        { id: 'v2', variant_name: 'Blue/L', sku: 'P1-B-L', price: '299', mrp: '350', stock_status: 'in_stock', inventory_quantity: 3, is_active: true },
      ])
      const result = await tool().handler({ productId: 'p1' })
      expect((result as any).variants).toHaveLength(2)
    })

    it('returns empty variants when none exist', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ productId: 'p-no-variants' })
      expect((result as any).variants).toHaveLength(0)
    })
  })

  describe('find_similar_products', () => {
    const tool = () => getTool('find_similar_products')!

    it('returns note when product has no embedding', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // no embedding row
      const result = await tool().handler({ productId: 'p1' })
      expect((result as any).products).toHaveLength(0)
      expect((result as any).note).toBeDefined()
    })

    it('returns empty products when no similar ids found', async () => {
      mockQueryOne.mockResolvedValueOnce({ embedding: '[0.1,0.2,0.3]' })
      mockQueryMany
        .mockResolvedValueOnce([]) // no similar rows
      const result = await tool().handler({ productId: 'p1' })
      expect((result as any).products).toHaveLength(0)
    })

    it('returns similar products when embedding and matches exist', async () => {
      mockQueryOne.mockResolvedValueOnce({ embedding: '[0.1,0.2,0.3]' })
      mockQueryMany
        .mockResolvedValueOnce([
          { source_id: 'p2', sim: 0.92 },
          { source_id: 'p3', sim: 0.88 },
        ])
        .mockResolvedValueOnce([
          { id: 'p2', name: 'Similar A', slug: 'similar-a', sku: 'SA1', price: '199', stock: 7 },
          { id: 'p3', name: 'Similar B', slug: 'similar-b', sku: 'SB1', price: '249', stock: 4 },
        ])
      const result = await tool().handler({ productId: 'p1', limit: 5 })
      expect((result as any).products).toHaveLength(2)
    })
  })

  describe('search_customers', () => {
    const tool = () => getTool('search_customers')!

    it('returns empty customers when no semantic or sql matches', async () => {
      mockFindSimilarCustomers.mockResolvedValueOnce([]) // no semantic hits
      mockQueryMany.mockResolvedValueOnce([])            // no SQL fallback hits
      const result = await tool().handler({ query: 'nobody' })
      expect((result as any).customers).toHaveLength(0)
    })

    it('returns customers via semantic search when replica returns matches', async () => {
      mockFindSimilarCustomers.mockResolvedValueOnce([
        { source_id: 'u1', source_table: 'users', content: 'Alice', similarity: 0.9, metadata: {} },
        { source_id: 'u2', source_table: 'users', content: 'Alex', similarity: 0.8, metadata: {} },
      ])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith', phone: null, created_at: '2024-01-01', paid_orders: 3, lifetime_value: '1500' },
        { id: 'u2', email: 'alex@test.com', first_name: 'Alex', last_name: 'Jones', phone: null, created_at: '2024-02-01', paid_orders: 1, lifetime_value: '500' },
      ])
      const result = await tool().handler({ query: 'alice', limit: 10 })
      expect((result as any).customers).toHaveLength(2)
      expect((result as any).source).toBe('semantic')
    })

    it('falls back to SQL ILIKE when semantic search returns empty', async () => {
      mockFindSimilarCustomers.mockResolvedValueOnce([])
      mockQueryMany.mockResolvedValueOnce([
        { id: 'u3', email: 'bob@test.com', first_name: 'Bob', last_name: 'Brown', phone: null, created_at: '2024-03-01', paid_orders: 0, lifetime_value: '0' },
      ])
      const result = await tool().handler({ query: 'bob' })
      expect((result as any).customers).toHaveLength(1)
      expect((result as any).source).toBe('sql_fallback')
    })

    it('falls back to SQL when findSimilarCustomers throws', async () => {
      mockFindSimilarCustomers.mockRejectedValueOnce(new Error('replica unreachable'))
      mockQueryMany.mockResolvedValueOnce([
        { id: 'u4', email: 'carol@test.com', first_name: 'Carol', last_name: 'White', phone: null, created_at: '2024-04-01', paid_orders: 1, lifetime_value: '300' },
      ])
      const result = await tool().handler({ query: 'carol' })
      expect((result as any).customers).toHaveLength(1)
      expect((result as any).source).toBe('sql_fallback')
    })
  })

  describe('get_customer', () => {
    const tool = () => getTool('get_customer')!

    it('throws when neither id nor email provided', async () => {
      await expect(tool().handler({})).rejects.toThrow('Provide id or email')
    })

    it('returns customer when found by id', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith',
        paid_orders: 2, lifetime_value: '800',
      })
      const result = await tool().handler({ id: 'u1' })
      expect((result as any).id).toBe('u1')
    })

    it('returns customer when found by email', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith',
        paid_orders: 2, lifetime_value: '800',
      })
      const result = await tool().handler({ email: 'alice@test.com' })
      expect((result as any).email).toBe('alice@test.com')
    })

    it('returns error object when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ email: 'ghost@test.com' })
      expect((result as any).error).toBe('Customer not found')
    })
  })

  describe('get_recent_orders', () => {
    const tool = () => getTool('get_recent_orders')!

    it('returns orders with default params', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'o1', order_number: 'ORD-001', status: 'delivered', payment_status: 'paid', total_amount: '500', created_at: '2024-01-10', customer_email: 'a@b.com', customer_name: 'Alice Smith' },
      ])
      const result = await tool().handler({})
      expect((result as any).orders).toHaveLength(1)
    })

    it('applies userId filter', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ userId: 'u1', days: 30 })
      expect((result as any).orders).toHaveLength(0)
      expect(mockQueryMany.mock.calls[0][1]).toContain('u1')
    })

    it('applies status filter', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ status: 'pending' })
      const params = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(params).toContain('pending')
    })

    it('returns truncated flag when result equals limit', async () => {
      const orders = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, order_number: `ORD-${i}` }))
      mockQueryMany.mockResolvedValueOnce(orders)
      const result = await tool().handler({ limit: 20 })
      expect((result as any).truncated).toBe(true)
    })
  })

  describe('get_order', () => {
    const tool = () => getTool('get_order')!

    it('throws when neither id nor orderNumber provided', async () => {
      await expect(tool().handler({})).rejects.toThrow('Provide id or orderNumber')
    })

    it('returns error when order not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ orderNumber: 'ORD-999' })
      expect((result as any).error).toBe('Order not found')
    })

    it('returns order with line items when found', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1', order_number: 'ORD-001', status: 'delivered', payment_status: 'paid',
        subtotal: '400', total_amount: '450', customer_email: 'a@b.com', customer_name: 'Alice Smith',
      })
      mockQueryMany.mockResolvedValueOnce([
        { product_name: 'Widget', product_sku: 'W1', variant_name: null, quantity: '2', unit_price: '200', total_price: '400' },
      ])
      const result = await tool().handler({ orderNumber: 'ORD-001' })
      expect((result as any).id).toBe('o1')
      expect((result as any).items).toHaveLength(1)
    })

    it('returns order by id', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o2', order_number: 'ORD-002', status: 'processing', payment_status: 'paid',
        subtotal: '200', total_amount: '220', customer_email: 'b@c.com', customer_name: 'Bob Jones',
      })
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ id: 'o2' })
      expect((result as any).order_number).toBe('ORD-002')
    })
  })

  describe('get_low_stock_products', () => {
    const tool = () => getTool('get_low_stock_products')!

    it('returns low-stock products with defaults', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Low Stock Item', sku: 'LS1', stock: 3, price: '199', brand: 'Brand', sold_30d: 5 },
      ])
      const result = await tool().handler({})
      expect((result as any).products).toHaveLength(1)
      expect((result as any).threshold).toBe(10)
    })

    it('respects custom threshold and limit', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ threshold: 5, limit: 10 })
      expect((result as any).threshold).toBe(5)
      expect(mockQueryMany.mock.calls[0][1]).toContain(5)
    })

    it('sets truncated flag when result equals limit', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, sku: `S${i}`, stock: 0, price: '10', brand: null, sold_30d: 0 }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await tool().handler({ limit: 50 })
      expect((result as any).truncated).toBe(true)
    })
  })

  describe('get_campaign_stats', () => {
    const tool = () => getTool('get_campaign_stats')!

    it('returns all campaign stats without kind filter', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { campaign_kind: 'abandoned_cart', sent: 200, opened: 80, clicked: 30, converted: 10 },
        { campaign_kind: 'welcome', sent: 50, opened: 40, clicked: 10, converted: 5 },
      ])
      const result = await tool().handler({})
      expect((result as any).campaigns).toHaveLength(2)
      expect((result as any).window_days).toBe(30)
    })

    it('filters by campaign kind when provided', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { campaign_kind: 'abandoned_cart', sent: 200, opened: 80, clicked: 30, converted: 10 },
      ])
      const result = await tool().handler({ kind: 'abandoned_cart', days: 7 })
      expect((result as any).window_days).toBe(7)
      const params = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(params).toContain('abandoned_cart')
    })
  })

  describe('send_test_email', () => {
    const tool = () => getTool('send_test_email')!

    it('throws when campaignKind is missing', async () => {
      await expect(tool().handler({ toEmail: 'a@b.com' })).rejects.toThrow()
    })

    it('throws when toEmail has no @ symbol', async () => {
      await expect(tool().handler({ campaignKind: 'welcome', toEmail: 'notanemail' })).rejects.toThrow()
    })

    it('throws when campaign not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(tool().handler({ campaignKind: 'ghost_campaign', toEmail: 'a@b.com' })).rejects.toThrow(/Unknown campaign/)
    })

    it('returns proposal when campaign exists and email is valid', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome Email' })
      const result = await tool().handler({ campaignKind: 'welcome', toEmail: 'test@example.com' })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('send_test_email')
      expect((result as any).payload.toEmail).toBe('test@example.com')
    })
  })

  describe('toggle_campaign_enabled', () => {
    const tool = () => getTool('toggle_campaign_enabled')!

    it('throws when campaign not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(tool().handler({ campaignKind: 'ghost', enabled: 'true' })).rejects.toThrow(/Unknown campaign/)
    })

    it('returns already-state info when campaign already matches target', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome Email', enabled: true })
      const result = await tool().handler({ campaignKind: 'welcome', enabled: 'true' })
      expect((result as any).proposed).toBe(false)
      expect((result as any).info).toMatch(/already/)
    })

    it('proposes enable when campaign is disabled', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome Email', enabled: false })
      const result = await tool().handler({ campaignKind: 'welcome', enabled: 'true' })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.enabled).toBe(true)
    })

    it('proposes disable when campaign is enabled', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome Email', enabled: true })
      const result = await tool().handler({ campaignKind: 'welcome', enabled: 'false' })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.enabled).toBe(false)
    })
  })

  describe('mark_order_shipped', () => {
    const tool = () => getTool('mark_order_shipped')!

    it('throws when order not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(tool().handler({ orderNumber: 'ORD-GHOST' })).rejects.toThrow(/Unknown order/)
    })

    it('returns not-proposed info when order is already shipped', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-001', status: 'shipped' })
      const result = await tool().handler({ orderNumber: 'ORD-001' })
      expect((result as any).proposed).toBe(false)
      expect((result as any).info).toMatch(/already/)
    })

    it('returns not-proposed info when order is already delivered', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-001', status: 'delivered' })
      const result = await tool().handler({ orderNumber: 'ORD-001' })
      expect((result as any).proposed).toBe(false)
    })

    it('proposes shipping without AWB', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-001', status: 'processing' })
      const result = await tool().handler({ orderNumber: 'ORD-001' })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.awbNumber).toBeNull()
    })

    it('proposes shipping with AWB number', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-001', status: 'confirmed' })
      const result = await tool().handler({ orderNumber: 'ORD-001', awbNumber: 'DEL123456' })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.awbNumber).toBe('DEL123456')
    })
  })

  describe('list_admin_tools', () => {
    const tool = () => getTool('list_admin_tools')!

    it('returns all tool names and mutating flags', async () => {
      const result = await tool().handler({})
      expect((result as any).tools).toBeDefined()
      expect(Array.isArray((result as any).tools)).toBe(true)
      expect((result as any).count).toBe(TOOLS.length)
      const names = (result as any).tools.map((t: any) => t.name)
      expect(names).toContain('run_sql_readonly')
      expect(names).toContain('call_admin_api')
    })
  })

  describe('run_sql_readonly', () => {
    const tool = () => getTool('run_sql_readonly')!

    it('rejects INSERT statement', async () => {
      await expect(tool().handler({ sql: 'INSERT INTO orders VALUES (1)' })).rejects.toThrow()
    })

    it('rejects UPDATE statement', async () => {
      await expect(tool().handler({ sql: 'UPDATE orders SET status = 1' })).rejects.toThrow()
    })

    it('rejects DELETE statement', async () => {
      await expect(tool().handler({ sql: 'DELETE FROM orders' })).rejects.toThrow()
    })

    it('rejects DROP statement', async () => {
      await expect(tool().handler({ sql: 'DROP TABLE users' })).rejects.toThrow()
    })

    it('rejects queries targeting admins table', async () => {
      await expect(tool().handler({ sql: 'SELECT * FROM admins' })).rejects.toThrow()
    })

    it('rejects queries targeting payment_methods table', async () => {
      await expect(tool().handler({ sql: 'SELECT * FROM payment_methods' })).rejects.toThrow()
    })

    it('rejects queries referencing password_hash column', async () => {
      await expect(tool().handler({ sql: 'SELECT password_hash FROM users' })).rejects.toThrow()
    })

    it('rejects SQL with embedded semicolons', async () => {
      await expect(tool().handler({ sql: 'SELECT 1; SELECT 2' })).rejects.toThrow()
    })

    it('rejects SQL over 4000 chars', async () => {
      const longSql = 'SELECT ' + 'a,'.repeat(2000) + 'b FROM orders'
      await expect(tool().handler({ sql: longSql })).rejects.toThrow()
    })

    it('rejects missing sql input', async () => {
      await expect(tool().handler({})).rejects.toThrow()
    })

    it('rejects non-SELECT statement that is not INSERT/UPDATE/DELETE', async () => {
      await expect(tool().handler({ sql: 'EXPLAIN SELECT 1' })).rejects.toThrow(/SELECT or WITH/)
    })

    it('executes valid SELECT via pg pool and returns rows', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'
      mockPgClient.query
        .mockResolvedValueOnce({}) // BEGIN READ ONLY
        .mockResolvedValueOnce({}) // SET LOCAL statement_timeout
        .mockResolvedValueOnce({ rows: [{ count: 5 }], rowCount: 1, fields: [{ name: 'count' }] }) // actual query
        .mockResolvedValueOnce({}) // ROLLBACK
      const result = await tool().handler({ sql: 'SELECT COUNT(*) FROM orders' })
      expect((result as any).rowCount).toBe(1)
      expect((result as any).rows).toHaveLength(1)
      expect((result as any).fields).toContain('count')
      delete process.env.DATABASE_URL
    })

    it('wraps pg errors in SQL error message', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'
      mockPgClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET timeout
        .mockRejectedValueOnce(new Error('syntax error')) // query fails
        .mockResolvedValueOnce({}) // ROLLBACK
      await expect(tool().handler({ sql: 'SELECT 1 FROM nonexistent_table' })).rejects.toThrow(/SQL error/)
      delete process.env.DATABASE_URL
    })

    it('sets truncated flag when row count equals 100', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'
      const manyRows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      mockPgClient.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: manyRows, rowCount: 100, fields: [{ name: 'id' }] })
        .mockResolvedValueOnce({})
      const result = await tool().handler({ sql: 'SELECT id FROM orders' })
      expect((result as any).truncated).toBe(true)
      delete process.env.DATABASE_URL
    })
  })

  describe('describe_schema', () => {
    const tool = () => getTool('describe_schema')!

    it('lists all non-forbidden tables when no table arg provided', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { table_name: 'orders', n_cols: 12 },
        { table_name: 'products', n_cols: 20 },
      ])
      const result = await tool().handler({})
      expect((result as any).tables).toHaveLength(2)
      expect((result as any).count).toBe(2)
    })

    it('returns error for forbidden table name', async () => {
      const result = await tool().handler({ table: 'admins' })
      expect((result as any).error).toBeDefined()
    })

    it('throws for invalid table name characters', async () => {
      await expect(tool().handler({ table: 'orders; DROP TABLE--' })).rejects.toThrow(/Invalid table name/)
    })

    it('returns columns for a valid table', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
        { column_name: 'status', data_type: 'text', is_nullable: 'YES', column_default: null },
      ])
      const result = await tool().handler({ table: 'orders' })
      expect((result as any).table).toBe('orders')
      expect((result as any).columns).toHaveLength(2)
    })

    it('filters out forbidden columns from results', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
        { column_name: 'password_hash', data_type: 'text', is_nullable: 'YES', column_default: null },
      ])
      const result = await tool().handler({ table: 'users' })
      const cols = (result as any).columns as { column_name: string }[]
      expect(cols.every(c => c.column_name !== 'password_hash')).toBe(true)
      expect((result as any).hidden).toBe(1)
    })
  })

  describe('estimate_email_audience', () => {
    const tool = () => getTool('estimate_email_audience')!

    it('throws for invalid audience value', async () => {
      await expect(tool().handler({ audience: 'invalid_audience' })).rejects.toThrow(/audience must be/)
    })

    it('returns count 1 for test_only audience with valid email', async () => {
      const result = await tool().handler({ audience: 'test_only', testEmail: 'admin@test.com' })
      expect((result as any).audience).toBe('test_only')
      expect((result as any).count).toBe(1)
      expect((result as any).sample).toContain('admin@test.com')
    })

    it('throws for test_only without valid email', async () => {
      await expect(tool().handler({ audience: 'test_only', testEmail: 'notvalid' })).rejects.toThrow()
    })

    it('returns count for all_opted_in audience', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 500 })
      const result = await tool().handler({ audience: 'all_opted_in' })
      expect((result as any).audience).toBe('all_opted_in')
      expect((result as any).count).toBe(500)
    })

    it('returns count for recent_buyers audience', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 120 })
      const result = await tool().handler({ audience: 'recent_buyers' })
      expect((result as any).audience).toBe('recent_buyers')
      expect((result as any).count).toBe(120)
    })

    it('handles null queryOne result gracefully', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await tool().handler({ audience: 'all_opted_in' })
      expect((result as any).count).toBe(0)
    })
  })

  describe('call_admin_api', () => {
    const tool = () => getTool('call_admin_api')!

    it('blocks /api/admin/agent/ paths', async () => {
      await expect(tool().handler({ path: '/api/admin/agent/actions', method: 'GET' })).rejects.toThrow(/forbidden|not accessible/i)
    })

    it('blocks /api/admin/admins paths', async () => {
      await expect(tool().handler({ path: '/api/admin/admins', method: 'GET' })).rejects.toThrow()
    })

    it('blocks /api/admin/auth paths', async () => {
      await expect(tool().handler({ path: '/api/admin/auth/login', method: 'POST' })).rejects.toThrow()
    })

    it('blocks /api/admin/team paths', async () => {
      await expect(tool().handler({ path: '/api/admin/team', method: 'GET' })).rejects.toThrow()
    })

    it('throws for unsupported HTTP method', async () => {
      await expect(tool().handler({ path: '/api/admin/orders', method: 'CONNECT' })).rejects.toThrow(/Unsupported method/)
    })

    it('throws when path does not start with /api/admin/', async () => {
      await expect(tool().handler({ path: '/api/customer/orders', method: 'GET' })).rejects.toThrow(/must start with/)
    })

    it('throws for malformed path with ..', async () => {
      await expect(tool().handler({ path: '/api/admin/../etc/passwd', method: 'GET' })).rejects.toThrow(/malformed/)
    })

    it('throws for body too large', async () => {
      const bigBody = JSON.stringify({ data: 'x'.repeat(17 * 1024) })
      await expect(tool().handler({ path: '/api/admin/products/draft', method: 'POST', body: bigBody })).rejects.toThrow(/too large/)
    })

    it('throws for invalid JSON body', async () => {
      await expect(tool().handler({ path: '/api/admin/products/draft', method: 'POST', body: '{invalid json' })).rejects.toThrow(/valid JSON/)
    })

    it('executes allowed GET request and returns immediate marker', async () => {
      const result = await tool().handler({ path: '/api/admin/orders', method: 'GET' })
      expect((result as any).proposed).toBe(false)
      expect((result as any).executeImmediate).toBe(true)
    })

    it('executes HEAD request as read (immediate)', async () => {
      const result = await tool().handler({ path: '/api/admin/orders', method: 'HEAD' })
      expect((result as any).proposed).toBe(false)
      expect((result as any).executeImmediate).toBe(true)
    })

    it('includes queryString in path when provided', async () => {
      const result = await tool().handler({ path: '/api/admin/orders', method: 'GET', queryString: 'status=pending&limit=5' })
      expect((result as any).path).toBe('/api/admin/orders?status=pending&limit=5')
    })

    it('proposes mutation for POST request', async () => {
      const result = await tool().handler({
        path: '/api/admin/products/draft',
        method: 'POST',
        body: JSON.stringify({ name: 'New Product' }),
      })
      expect((result as any).proposed).toBe(true)
    })

    it('proposes mutation for PATCH request', async () => {
      const result = await tool().handler({
        path: '/api/admin/orders/o1',
        method: 'PATCH',
        body: JSON.stringify({ status: 'shipped' }),
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('call_admin_api')
    })

    it('proposes mutation for DELETE request', async () => {
      const result = await tool().handler({ path: '/api/admin/products/p1', method: 'DELETE' })
      expect((result as any).proposed).toBe(true)
    })
  })

  describe('find_customer_orders', () => {
    const tool = () => getTool('find_customer_orders')!

    it('throws when customerQuery is empty', async () => {
      await expect(tool().handler({ customerQuery: '' })).rejects.toThrow(/customerQuery is required/)
    })

    it('returns needs_choice when multiple customers match', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: null },
        { id: 'u2', email: 'alice2@test.com', first_name: 'Alice', last_name: 'Smith' },
      ])

      const result = await tool().handler({ customerQuery: 'alice' })
      expect((result as any).needs_choice).toBe(true)
      expect((result as any).options).toHaveLength(2)
    })

    it('returns orders when single customer found', async () => {
      mockQueryMany
        .mockResolvedValueOnce([{ id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith' }])
        .mockResolvedValueOnce([
          { id: 'o1', order_number: 'ORD-001', status: 'delivered', payment_status: 'paid', total_amount: '500', created_at: '2024-01-01' },
        ])

      const result = await tool().handler({ customerQuery: 'alice@test.com' })
      expect((result as any).customer).toBeDefined()
      expect((result as any).orders).toHaveLength(1)
    })

    it('returns empty when no customer found', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ customerQuery: 'nobody' })
      expect((result as any).customers).toHaveLength(0)
    })
  })

  describe('propose_order_delay_email', () => {
    const tool = () => getTool('propose_order_delay_email')!

    it('throws when reason is empty', async () => {
      await expect(tool().handler({ orderId: 'o1', reason: '', delayDays: 3 })).rejects.toThrow(/reason is required/)
    })

    it('throws when reason is too long', async () => {
      await expect(tool().handler({ orderId: 'o1', reason: 'x'.repeat(281), delayDays: 3 })).rejects.toThrow(/too long/)
    })

    it('throws when neither orderId nor orderNumber provided', async () => {
      await expect(tool().handler({ reason: 'test reason', delayDays: 3 })).rejects.toThrow(/Provide orderId or orderNumber/)
    })

    it('rejects when order is delivered', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-001', status: 'delivered', customer_email: 'a@b.com', customer_name: 'Alice' })
      const result = await tool().handler({ orderId: 'o1', reason: 'warehouse issue', delayDays: 7 })
      expect((result as any).proposed).toBe(false)
    })

    it('rejects when order is cancelled', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-001', status: 'cancelled', customer_email: 'a@b.com', customer_name: 'Alice' })
      const result = await tool().handler({ orderId: 'o1', reason: 'out of stock', delayDays: 7 })
      expect((result as any).proposed).toBe(false)
    })

    it('proposes email for valid pending order', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1',
        order_number: 'ORD-001',
        status: 'processing',
        customer_email: 'customer@test.com',
        customer_name: 'Bob',
      })
      const result = await tool().handler({ orderId: 'o1', reason: 'supplier delay', delayDays: 7 })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.delayDays).toBe(7)
    })

    it('proposes with singular day in confirmation for delayDays=1', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1', order_number: 'ORD-001', status: 'confirmed',
        customer_email: 'c@d.com', customer_name: 'Carol',
      })
      const result = await tool().handler({ orderId: 'o1', reason: 'delay', delayDays: 1 })
      expect((result as any).confirmation).toMatch(/1 day[^s]/)
    })

    it('throws when order not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(tool().handler({ orderId: 'nonexistent', reason: 'test', delayDays: 7 })).rejects.toThrow('Order not found')
    })

    it('throws when order has no customer email', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1', order_number: 'ORD-001', status: 'processing',
        customer_email: null, customer_name: 'Ghost',
      })
      await expect(tool().handler({ orderId: 'o1', reason: 'delay', delayDays: 3 })).rejects.toThrow(/no customer email/)
    })
  })

  describe('get_recent_products', () => {
    const tool = () => getTool('get_recent_products')!

    it('returns recently added products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'New Product', slug: 'new-product', sku: 'NP1', price: '299', short_description: null, stock: 10, brand: 'BrandX', category: 'Cat1', created_at: '2024-06-01' },
      ])
      const result = await tool().handler({})
      expect((result as any).products).toHaveLength(1)
      expect((result as any).count).toBe(1)
    })

    it('respects custom limit', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ limit: 3 })
      expect(mockQueryMany.mock.calls[0][1]).toContain(3)
    })
  })

  describe('list_featured_products', () => {
    const tool = () => getTool('list_featured_products')!

    it('returns featured products', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Featured', slug: 'featured', sku: 'F1', price: 499, stock: 20, image_url: null, brand: null, category: null },
      ])
      const result = await tool().handler({})
      expect((result as any).data.products).toHaveLength(1)
      expect((result as any).count).toBe(1)
    })

    it('returns empty array when no featured products', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ limit: 5 })
      expect((result as any).data.products).toHaveLength(0)
    })
  })

  describe('propose_product_announcement_email', () => {
    const tool = () => getTool('propose_product_announcement_email')!

    it('rejects intro with HTML tags', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: '<a href="https://example.com">Buy now!</a>',
        subject: 'New product',
      })).rejects.toThrow()
    })

    it('rejects intro with markdown links', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'Check [this](http://example.com) out',
        subject: 'New product',
      })).rejects.toThrow()
    })

    it('rejects intro with markdown images', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'See ![img](http://example.com/img.png)',
        subject: 'New product',
      })).rejects.toThrow()
    })

    it('rejects when productIds is empty', async () => {
      await expect(tool().handler({
        productIds: [],
        audience: 'all_opted_in',
        intro: 'Great new products.',
        subject: 'New Arrivals',
      })).rejects.toThrow(/1-10 productIds/)
    })

    it('rejects when productIds has more than 10', async () => {
      await expect(tool().handler({
        productIds: Array.from({ length: 11 }, (_, i) => `p${i}`),
        audience: 'all_opted_in',
        intro: 'Great new products.',
        subject: 'New Arrivals',
      })).rejects.toThrow(/1-10 productIds/)
    })

    it('rejects invalid audience value', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'mystery_list',
        intro: 'Great new products.',
        subject: 'New Arrivals',
      })).rejects.toThrow(/audience must be/)
    })

    it('rejects subject that is too long', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'Short intro.',
        subject: 'x'.repeat(81),
      })).rejects.toThrow(/subject/)
    })

    it('rejects intro that is too long', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'x'.repeat(241),
        subject: 'New Arrivals',
      })).rejects.toThrow(/intro/)
    })

    it('returns not-proposed when some productIds do not resolve', async () => {
      mockQueryMany.mockResolvedValueOnce([]) // 0 products resolved from 1 id
      const result = await tool().handler({
        productIds: ['nonexistent-id'],
        audience: 'all_opted_in',
        intro: 'Check these out.',
        subject: 'New Arrivals',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('proposes email for clean intro with all_opted_in audience', async () => {
      mockQueryMany.mockResolvedValueOnce([{
        id: 'p1',
        name: 'Test Product',
        slug: 'test-product',
        price: '499',
        short_description: null,
      }])
      mockQueryOne.mockResolvedValueOnce({ n: 100 })
      const result = await tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'Introducing our newest product for everyday use.',
        subject: 'New Arrival',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.audienceCount).toBe(100)
    })

    it('proposes email with recent_buyers audience', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'Widget', slug: 'widget', price: '199', short_description: null }])
      mockQueryOne.mockResolvedValueOnce({ n: 45 })
      const result = await tool().handler({
        productIds: ['p1'],
        audience: 'recent_buyers',
        intro: 'Based on recent purchases you might love this.',
        subject: 'Just for you',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.audience).toBe('recent_buyers')
    })

    it('proposes email with test_only audience', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'Widget', slug: 'widget', price: '199', short_description: null }])
      const result = await tool().handler({
        productIds: ['p1'],
        audience: 'test_only',
        testEmail: 'me@test.com',
        intro: 'Just testing this email template.',
        subject: 'Test Send',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.testEmail).toBe('me@test.com')
      expect((result as any).payload.audienceCount).toBe(1)
    })

    it('throws when test_only audience lacks valid testEmail', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'Widget', slug: 'widget', price: '199', short_description: null }])
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'test_only',
        testEmail: 'notanemail',
        intro: 'Testing.',
        subject: 'Test',
      })).rejects.toThrow(/testEmail required/)
    })

    it('rejects intro with <img> HTML tag', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'Check out <img src="x.jpg"> this product.',
        subject: 'New product',
      })).rejects.toThrow()
    })

    it('rejects intro with <a href= HTML tag', async () => {
      await expect(tool().handler({
        productIds: ['p1'],
        audience: 'all_opted_in',
        intro: 'Visit us at <a href="https://example.com">here</a>.',
        subject: 'New product',
      })).rejects.toThrow()
    })
  })

  describe('search_customers (embed/query failure branch)', () => {
    const tool = () => getTool('search_customers')!

    it('handles findSimilarCustomers throwing and falls back to SQL', async () => {
      mockFindSimilarCustomers.mockRejectedValueOnce(new Error('network error'))
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ query: 'alice' })
      expect((result as any).customers).toHaveLength(0)
      expect((result as any).source).toBe('sql_fallback')
    })
  })

  describe('get_recent_customers', () => {
    const tool = () => getTool('get_recent_customers')!

    it('returns customers joined in the last 7 days by default', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'u1', email: 'new@test.com', first_name: 'New', last_name: 'User', phone: null, created_at: '2026-06-25', paid_orders: 0 },
      ])
      const result = await tool().handler({})
      expect((result as any).customers).toHaveLength(1)
      expect((result as any).days).toBe(7)
      expect((result as any).count).toBe(1)
    })

    it('respects custom days and limit params', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ days: 30, limit: 50 })
      expect((result as any).days).toBe(30)
      const params = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(params[0]).toBe(30)
      expect(params[1]).toBe(50)
    })

    it('clamps days to max 90', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await tool().handler({ days: 999 })
      const params = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(params[0]).toBe(90)
    })

    it('returns empty array when no recent customers', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await tool().handler({ days: 1 })
      expect((result as any).customers).toHaveLength(0)
      expect((result as any).count).toBe(0)
    })
  })

  describe('list_repo_files', () => {
    const tool = () => getTool('list_repo_files')!

    it('throws for empty dir', async () => {
      await expect(tool().handler({ dir: '' })).rejects.toThrow(/Invalid dir/)
    })

    it('throws for dir containing ..', async () => {
      await expect(tool().handler({ dir: '../etc' })).rejects.toThrow(/Invalid dir/)
    })

    it('throws for forbidden path (node_modules)', async () => {
      await expect(tool().handler({ dir: 'node_modules/something' })).rejects.toThrow(/forbidden/)
    })

    it('throws for path containing "secret"', async () => {
      await expect(tool().handler({ dir: 'src/lib/secret-stuff' })).rejects.toThrow(/forbidden/)
    })

    it('returns files from a valid directory', async () => {
      const fakeEnt = (name: string, isDir: boolean) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      })
      mockFs.readdir
        .mockResolvedValueOnce([fakeEnt('queries.ts', false), fakeEnt('utils.ts', false)])
      mockFs.stat
        .mockResolvedValueOnce({ size: 1024 })
        .mockResolvedValueOnce({ size: 512 })
      const result = await tool().handler({ dir: 'src/lib' })
      expect((result as any).files).toBeDefined()
      expect((result as any).count).toBeGreaterThanOrEqual(0)
    })

    it('applies pattern filter to filenames', async () => {
      const fakeEnt = (name: string) => ({ name, isDirectory: () => false, isFile: () => true })
      mockFs.readdir.mockResolvedValueOnce([fakeEnt('queries.ts'), fakeEnt('utils.ts')])
      mockFs.stat.mockResolvedValueOnce({ size: 100 })
      const result = await tool().handler({ dir: 'src/lib', pattern: 'queries' })
      const files = (result as any).files as { path: string }[]
      expect(files.every(f => f.path.includes('queries'))).toBe(true)
    })

    it('skips node_modules subdirectories during walk', async () => {
      const fakeDir = (name: string) => ({ name, isDirectory: () => true, isFile: () => false })
      const fakeFile = (name: string) => ({ name, isDirectory: () => false, isFile: () => true })
      // First readdir returns node_modules (dir) and a file
      mockFs.readdir.mockResolvedValueOnce([fakeDir('node_modules'), fakeFile('index.ts')])
      mockFs.stat.mockResolvedValueOnce({ size: 200 })
      const result = await tool().handler({ dir: 'src' })
      // node_modules should not be walked — readdir should only be called once
      expect(mockFs.readdir).toHaveBeenCalledTimes(1)
    })

    it('handles readdir throwing (returns empty list)', async () => {
      mockFs.readdir.mockRejectedValueOnce(new Error('ENOENT'))
      const result = await tool().handler({ dir: 'src/lib/nonexistent' })
      expect((result as any).files).toHaveLength(0)
    })
  })

  describe('read_repo_file', () => {
    const tool = () => getTool('read_repo_file')!

    it('throws for empty path', async () => {
      await expect(tool().handler({ path: '' })).rejects.toThrow(/Invalid path/)
    })

    it('throws for path containing ..', async () => {
      await expect(tool().handler({ path: '../../../etc/passwd' })).rejects.toThrow(/Invalid path/)
    })

    it('throws for forbidden path (.env)', async () => {
      await expect(tool().handler({ path: '.env' })).rejects.toThrow(/forbidden/)
    })

    it('throws for forbidden path (lib/auth.ts)', async () => {
      await expect(tool().handler({ path: 'src/lib/auth.ts' })).rejects.toThrow(/forbidden/)
    })

    it('throws for path with password keyword', async () => {
      await expect(tool().handler({ path: 'src/lib/password-helper.ts' })).rejects.toThrow(/forbidden/)
    })

    it('returns file content for a valid path', async () => {
      const fakeContent = Buffer.from('export const foo = 1\n')
      const fakeHandle = {
        stat: vi.fn().mockResolvedValue({ size: fakeContent.length }),
        read: vi.fn().mockImplementation((buf: Buffer) => {
          fakeContent.copy(buf)
          return Promise.resolve({ bytesRead: fakeContent.length })
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }
      mockFs.open.mockResolvedValueOnce(fakeHandle)
      const result = await tool().handler({ path: 'src/lib/queries.ts' })
      expect((result as any).content).toContain('foo')
      expect((result as any).bytesRead).toBe(fakeContent.length)
    })

    it('throws File not found for ENOENT', async () => {
      const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockFs.open.mockRejectedValueOnce(enoentErr)
      await expect(tool().handler({ path: 'src/lib/does-not-exist.ts' })).rejects.toThrow(/File not found/)
    })

    it('re-throws non-ENOENT errors', async () => {
      mockFs.open.mockRejectedValueOnce(new Error('EPERM: permission denied'))
      await expect(tool().handler({ path: 'src/lib/queries.ts' })).rejects.toThrow(/EPERM/)
    })
  })

  describe('list_admin_api_routes', () => {
    const tool = () => getTool('list_admin_api_routes')!

    it('returns routes found in the api/admin directory', async () => {
      const fakeDir = (name: string) => ({ name, isDirectory: () => true, isFile: () => false })
      const fakeFile = (name: string) => ({ name, isDirectory: () => false, isFile: () => true })

      // Walk: root dir has 'orders' subdir
      mockFs.readdir
        .mockResolvedValueOnce([fakeDir('orders')]) // root
        .mockResolvedValueOnce([fakeFile('route.ts')]) // orders/

      // Source contains a GET export
      mockFs.readFile.mockResolvedValueOnce('export async function GET(req: Request) {}')

      const result = await tool().handler({})
      const routes = (result as any).routes as { path: string; methods: string[] }[]
      expect(routes.length).toBeGreaterThan(0)
      expect(routes[0].methods).toContain('GET')
    })

    it('filters routes by pathContains substring', async () => {
      const fakeDir = (name: string) => ({ name, isDirectory: () => true, isFile: () => false })
      const fakeFile = (name: string) => ({ name, isDirectory: () => false, isFile: () => true })

      mockFs.readdir
        .mockResolvedValueOnce([fakeDir('orders'), fakeDir('brands')])
        .mockResolvedValueOnce([fakeFile('route.ts')]) // orders
        .mockResolvedValueOnce([fakeFile('route.ts')]) // brands

      mockFs.readFile
        .mockResolvedValueOnce('export async function GET(req: Request) {}') // orders
        .mockResolvedValueOnce('export async function GET(req: Request) {}') // brands

      const result = await tool().handler({ pathContains: 'orders' })
      const routes = (result as any).routes as { path: string }[]
      expect(routes.every(r => r.path.includes('orders'))).toBe(true)
    })

    it('excludes forbidden subpaths (agent/, admins, auth, team)', async () => {
      const fakeDir = (name: string) => ({ name, isDirectory: () => true, isFile: () => false })
      const fakeFile = (name: string) => ({ name, isDirectory: () => false, isFile: () => true })

      // Forbidden paths require a sub-route (e.g. agent/actions, not just agent)
      // The source regex: /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/
      mockFs.readdir
        .mockResolvedValueOnce([fakeDir('agent'), fakeDir('admins'), fakeDir('auth'), fakeDir('team')])
        .mockResolvedValueOnce([fakeDir('actions')]) // agent -> agent/actions
        .mockResolvedValueOnce([fakeFile('route.ts')]) // agent/actions/route.ts
        .mockResolvedValueOnce([fakeFile('route.ts')]) // admins/route.ts
        .mockResolvedValueOnce([fakeFile('route.ts')]) // auth/route.ts
        .mockResolvedValueOnce([fakeFile('route.ts')]) // team/route.ts

      mockFs.readFile.mockResolvedValue('export async function GET(req: Request) {}')

      const result = await tool().handler({})
      const routes = (result as any).routes as { path: string }[]
      // The source regex filters agent/ (with slash), admins, auth, team — none should appear
      const FORBIDDEN_PATH_RE = /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/
      for (const { path } of routes) {
        expect(FORBIDDEN_PATH_RE.test(path)).toBe(false)
      }
    })

    it('returns empty routes when no route files exist', async () => {
      mockFs.readdir.mockResolvedValueOnce([])
      const result = await tool().handler({})
      expect((result as any).routes).toHaveLength(0)
      expect((result as any).count).toBe(0)
    })

    it('handles readdir throwing gracefully', async () => {
      mockFs.readdir.mockRejectedValueOnce(new Error('ENOENT'))
      const result = await tool().handler({})
      expect((result as any).routes).toHaveLength(0)
    })
  })
})
