import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module mocks (must be hoisted before imports) ─────────────────────────────

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  getClient: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendOrderAutoCancelledEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderAutoCancelledAdminNotification: vi.fn().mockResolvedValue(undefined),
  sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/search', () => ({
  buildProductSearchClause: vi.fn().mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 2 }),
  // getStockValuation now reuses the shared buildSearchClause (per-word substring +
  // pg_trgm word_similarity fuzzy fallback). Mirror its contract: the first param it
  // emits for a single-word search is the substring `%word%`.
  buildSearchClause: vi.fn((raw: string, _columns: string[], startIdx: number = 1) => ({
    clause: 'TRUE',
    params: [`%${raw}%`],
    nextIdx: startIdx + 1,
  })),
  // getStockValuation orders search results by the shared product-search rank. Mirror
  // its contract: a rank SQL expression plus the params it binds, from startIdx.
  buildProductSearchRank: vi.fn((raw: string, _nameCol: string, _vectorCol: string, startIdx: number = 1) => ({
    rank: '0',
    params: [`%${raw}%`],
    nextIdx: startIdx + 1,
  })),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { query, queryOne, queryMany } from '@/lib/db'
import { buildProductSearchClause } from '@/lib/search'
import { logStockMovement, updateWeightedAvgCost, getStockLedger, getStockValuation } from '@/lib/inventory'
import { cancelOrder, CANCELLABLE_STATUSES } from '@/lib/orders'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

// Shared mock PoolClient
const mockClient = {
  query: vi.fn(),
} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockReset()
})

// ═════════════════════════════════════════════════════════════════════════════
// inventory.ts
// ═════════════════════════════════════════════════════════════════════════════

describe('logStockMovement', () => {
  const baseParams = {
    productId: 'prod-1',
    variantId: null,
    transactionType: 'sale' as const,
    quantityChange: -2,
    referenceType: 'order' as const,
    referenceId: 'order-abc',
  }

  it('uses client.query when a PoolClient is provided', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 })

    await logStockMovement(mockClient, { ...baseParams, currentStock: 10 })

    expect(mockClient.query).toHaveBeenCalledTimes(1)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('uses module query() when client is null', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryOne.mockResolvedValue({ inventory_quantity: 20 } as any)

    await logStockMovement(null, baseParams)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockClient.query).not.toHaveBeenCalled()
  })

  it('passes currentStock directly without DB lookup when provided', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 })

    await logStockMovement(mockClient, { ...baseParams, currentStock: 5 })

    // Only one call — the INSERT, no SELECT
    expect(mockClient.query).toHaveBeenCalledTimes(1)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('fetches stock from product_sub_variants when subVariantId is set', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 8 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, {
      ...baseParams,
      variantId: 'var-1',
      subVariantId: 'sv-1',
    })

    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('product_sub_variants'), ['sv-1'])
  })

  it('fetches stock from product_variants when variantId is set (no subVariantId)', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 15 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, { ...baseParams, variantId: 'var-1' })

    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('product_variants'), ['var-1'])
  })

  it('fetches stock from products table when only productId given', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 3 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, baseParams)

    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('FROM products'), ['prod-1'])
  })

  it('handles null inventory_quantity gracefully (treats as 0)', async () => {
    mockQueryOne.mockResolvedValue(null as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await expect(logStockMovement(null, baseParams)).resolves.not.toThrow()
  })

  it('computes quantity_after = currentStock + quantityChange (rounded)', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 })

    await logStockMovement(mockClient, { ...baseParams, currentStock: 7, quantityChange: -2 })

    const callArgs = mockClient.query.mock.calls[0]
    const values = callArgs[1] as any[]
    // quantity_after is index 5 in values array: [productId, variantId, subVariantId, txType, qtyChange, qtyAfter, ...]
    expect(values[5]).toBe(5) // 7 + (-2) = 5
  })

  it('includes optional fields (notes, unitId, unitLabel, unitFactor, quantityInUnit)', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 })

    await logStockMovement(mockClient, {
      ...baseParams,
      currentStock: 10,
      notes: 'test note',
      unitId: 'unit-1',
      unitLabel: 'pcs',
      unitFactor: 1,
      quantityInUnit: 2,
    })

    const values = mockClient.query.mock.calls[0][1] as any[]
    expect(values[8]).toBe('test note')
    expect(values[9]).toBe('unit-1')
    expect(values[10]).toBe('pcs')
    expect(values[11]).toBe(1)
    expect(values[12]).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('updateWeightedAvgCost', () => {
  it('updates variant cost_price when variantId is provided', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10, cost_price: 100 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await updateWeightedAvgCost(mockClient, {
      productId: 'prod-1',
      variantId: 'var-1',
      qtyReceived: 10,
      unitCost: 120,
    })

    expect(mockClient.query).toHaveBeenCalledTimes(2)
    const updateCall = mockClient.query.mock.calls[1]
    expect(updateCall[0]).toMatch(/UPDATE product_variants/)
    // weighted avg: (10*100 + 10*120) / 20 = 110
    expect(updateCall[1][0]).toBe(110)
    expect(updateCall[1][1]).toBe('var-1')
  })

  it('updates product cost_price when variantId is null', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: 5, cost_price: 200 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await updateWeightedAvgCost(mockClient, {
      productId: 'prod-1',
      variantId: null,
      qtyReceived: 5,
      unitCost: 300,
    })

    const updateCall = mockClient.query.mock.calls[1]
    expect(updateCall[0]).toMatch(/UPDATE products/)
    // weighted avg: (5*200 + 5*300) / 10 = 250
    expect(updateCall[1][0]).toBe(250)
    expect(updateCall[1][1]).toBe('prod-1')
  })

  it('uses unitCost directly when existing stock is 0', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: 0, cost_price: 0 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await updateWeightedAvgCost(mockClient, {
      productId: 'prod-1',
      variantId: 'var-1',
      qtyReceived: 5,
      unitCost: 150,
    })

    const updateCall = mockClient.query.mock.calls[1]
    expect(updateCall[1][0]).toBe(150)
  })

  it('handles null row (no existing product row) gracefully', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // no row returned
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await expect(
      updateWeightedAvgCost(mockClient, {
        productId: 'prod-1',
        variantId: null,
        qtyReceived: 3,
        unitCost: 50,
      })
    ).resolves.not.toThrow()
  })

  it('rounds cost_price to 2 decimal places', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: 1, cost_price: 100 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await updateWeightedAvgCost(mockClient, {
      productId: 'prod-1',
      variantId: 'var-1',
      qtyReceived: 2,
      unitCost: 101,
    })

    const updateCall = mockClient.query.mock.calls[1]
    const storedCost = updateCall[1][0] as number
    expect(storedCost).toBe(Math.round(storedCost * 100) / 100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('getStockLedger', () => {
  it('returns rows and total with no filters', async () => {
    mockQueryOne.mockResolvedValue({ total: 5 } as any)
    mockQueryMany.mockResolvedValue([{ id: 'txn-1' }, { id: 'txn-2' }] as any)

    const result = await getStockLedger({})

    expect(result.total).toBe(5)
    expect(result.rows).toHaveLength(2)
  })

  it('filters by productId', async () => {
    mockQueryOne.mockResolvedValue({ total: 1 } as any)
    mockQueryMany.mockResolvedValue([{ id: 'txn-1' }] as any)

    await getStockLedger({ productId: 'prod-42' })

    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('it.product_id')
    const countParams = mockQueryOne.mock.calls[0][1] as any[]
    expect(countParams).toContain('prod-42')
  })

  it('filters by date range (from and to)', async () => {
    mockQueryOne.mockResolvedValue({ total: 0 } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockLedger({ from: '2025-01-01', to: '2025-12-31' })

    const params = mockQueryOne.mock.calls[0][1] as any[]
    expect(params).toContain('2025-01-01')
    expect(params.some((p: string) => p.startsWith('2025-12-31'))).toBe(true)
  })

  it('calls buildProductSearchClause when search is provided', async () => {
    mockQueryOne.mockResolvedValue({ total: 0 } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockLedger({ search: 'bolt' })

    expect(buildProductSearchClause).toHaveBeenCalledWith(
      'bolt',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    )
  })

  it('defaults limit to 50 and offset to 0', async () => {
    mockQueryOne.mockResolvedValue({ total: 2 } as any)
    mockQueryMany.mockResolvedValue([{ id: 'x' }] as any)

    await getStockLedger({})

    const listParams = mockQueryMany.mock.calls[0][1] as any[]
    const last2 = listParams.slice(-2)
    expect(last2).toEqual([50, 0])
  })

  it('respects custom limit and offset', async () => {
    mockQueryOne.mockResolvedValue({ total: 100 } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockLedger({ limit: 20, offset: 40 })

    const listParams = mockQueryMany.mock.calls[0][1] as any[]
    const last2 = listParams.slice(-2)
    expect(last2).toEqual([20, 40])
  })

  it('returns empty rows array when queryMany returns null', async () => {
    mockQueryOne.mockResolvedValue({ total: 0 } as any)
    mockQueryMany.mockResolvedValue(null as any)

    const result = await getStockLedger({})
    expect(result.rows).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('getStockValuation', () => {
  it('returns products, total, and totalValue with no filters', async () => {
    mockQueryOne.mockResolvedValue({ total: 3, total_value: '450.75' } as any)
    mockQueryMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as any)

    const result = await getStockValuation()

    expect(result.total).toBe(3)
    expect(result.totalValue).toBe(450.75)
    expect(result.products).toHaveLength(3)
  })

  it('filters by search term', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ search: 'screw' })

    const params = mockQueryOne.mock.calls[0][1] as any[]
    expect(params[0]).toBe('%screw%')
  })

  it('filters by categoryName', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ categoryName: 'Fasteners' })

    const params = mockQueryOne.mock.calls[0][1] as any[]
    expect(params).toContain('Fasteners')
  })

  it('filters by brandName', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ brandName: 'Unbrako' })

    const params = mockQueryOne.mock.calls[0][1] as any[]
    expect(params).toContain('Unbrako')
  })

  it('stockStatus=in_stock appends inventory_quantity > 0 clause', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ stockStatus: 'in_stock' })

    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('inventory_quantity > 0')
  })

  it('stockStatus=out_of_stock appends inventory_quantity <= 0 clause', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ stockStatus: 'out_of_stock' })

    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('inventory_quantity <= 0')
  })

  it('stockStatus=low_stock appends low stock clause', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ stockStatus: 'low_stock' })

    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('inventory_quantity > 0 AND rows.inventory_quantity <= 5')
  })

  it('handles missing total_value gracefully (defaults to 0)', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: null } as any)
    mockQueryMany.mockResolvedValue([] as any)

    const result = await getStockValuation()
    expect(result.totalValue).toBe(0)
  })

  it('returns empty products array when queryMany returns null', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    // filterMeta call (allCategories/allBrands) comes first, then the paginated products call
    mockQueryMany.mockResolvedValueOnce([] as any) // filterMeta
    mockQueryMany.mockResolvedValueOnce(null as any) // products

    const result = await getStockValuation()
    expect(result.products).toEqual([])
  })

  it('respects custom limit and offset', async () => {
    mockQueryOne.mockResolvedValue({ total: 0, total_value: '0' } as any)
    mockQueryMany.mockResolvedValue([] as any)

    await getStockValuation({ limit: 10, offset: 30 })

    // calls[0] = filterMeta, calls[1] = paginated products
    const pageParams = mockQueryMany.mock.calls[1][1] as any[]
    expect(pageParams.slice(-2)).toEqual([10, 30])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// orders.ts
// ═════════════════════════════════════════════════════════════════════════════

describe('CANCELLABLE_STATUSES', () => {
  it('exports the correct cancellable statuses', () => {
    expect(CANCELLABLE_STATUSES).toEqual(expect.arrayContaining(['pending', 'confirmed', 'processing']))
    expect(CANCELLABLE_STATUSES).not.toContain('shipped')
    expect(CANCELLABLE_STATUSES).not.toContain('delivered')
    expect(CANCELLABLE_STATUSES).not.toContain('cancelled')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    order_number: 'ORD-001',
    status: 'pending',
    payment_status: 'unpaid',
    user_id: 'user-1',
    order_type: 'cart',
    customer_name: 'Test Customer',
    customer_email: 'test@example.com',
    total_amount: '500.00',
    users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    ...overrides,
  }
}

describe('cancelOrder', () => {
  describe('order lookup failures', () => {
    it('returns 404 when order is not found', async () => {
      mockQueryOne.mockResolvedValue(null as any)

      const result = await cancelOrder('missing-id', { reason: 'user_request' })

      expect(result).toEqual({ success: false, error: 'Order not found', status: 404 })
    })

    it('returns 404 when expectedUserId does not match order user_id', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ user_id: 'user-1' }) as any)

      const result = await cancelOrder('order-1', {
        reason: 'user_request',
        expectedUserId: 'user-WRONG',
      })

      expect(result).toEqual({ success: false, error: 'Order not found', status: 404 })
    })
  })

  describe('non-cancellable status', () => {
    it('returns 400 for shipped status', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ status: 'shipped' }) as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: false, status: 400 })
      expect((result as any).error).toContain('shipped')
    })

    it('returns 400 for delivered status', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ status: 'delivered' }) as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: false, status: 400 })
    })

    it('returns 400 for already-cancelled status', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ status: 'cancelled' }) as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: false, status: 400 })
    })
  })

  describe('direct cancel path (unpaid + pending)', () => {
    it('cancels order directly when unpaid+pending, no restoreToCart', async () => {
      mockQueryOne.mockResolvedValue(makeOrder() as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toEqual({ success: true, directCancel: true, restoredToCart: false })
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'cancelled'"), ['order-1'])
    })

    it('cancels when payment_status is failed', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ payment_status: 'failed' }) as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: true, directCancel: true })
    })

    it('restores items to cart when restoreToCart=true and cart item exists', async () => {
      const order = makeOrder({ order_type: 'cart' })
      mockQueryOne
        .mockResolvedValueOnce(order as any) // order lookup
        .mockResolvedValueOnce({ id: 'cart-item-1', quantity: 1 } as any) // existing cart item
      mockQueryMany.mockResolvedValue([{ product_id: 'p1', variant_id: null, quantity: 2, unit_price: 50 }] as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', {
        reason: 'user_request',
        restoreToCart: true,
      })

      expect(result).toEqual({ success: true, directCancel: true, restoredToCart: true })
      // Should UPDATE existing cart item
      const updateCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('UPDATE cart_items'))
      expect(updateCall).toBeDefined()
    })

    it('inserts new cart item when no existing cart item found', async () => {
      const order = makeOrder({ order_type: 'cart' })
      mockQueryOne.mockResolvedValueOnce(order as any).mockResolvedValueOnce(null as any) // no existing cart item
      mockQueryMany.mockResolvedValue([{ product_id: 'p1', variant_id: null, quantity: 1, unit_price: 100 }] as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', {
        reason: 'user_request',
        restoreToCart: true,
      })

      expect(result).toMatchObject({ success: true, restoredToCart: true })
      const insertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('INSERT INTO cart_items'))
      expect(insertCall).toBeDefined()
    })

    it('does NOT restore to cart for direct order_type even if restoreToCart=true', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ order_type: 'direct' }) as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', {
        reason: 'user_request',
        restoreToCart: true,
      })

      expect(result).toEqual({ success: true, directCancel: true, restoredToCart: false })
    })

    it('sends auto-cancel email for auto_cancel_unpaid reason', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')
      const mockSendEmail = vi.mocked(sendOrderAutoCancelledEmail)

      mockQueryOne.mockResolvedValue(makeOrder() as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(mockSendEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Test User',
        'ORD-001',
        'order-1',
        'cart',
        500,
        '/cart'
      )
    })

    it('resolves redirectPath to product slug for direct order_type (auto_cancel_unpaid)', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')
      const mockSendEmail = vi.mocked(sendOrderAutoCancelledEmail)

      mockQueryOne
        .mockResolvedValueOnce(makeOrder({ order_type: 'direct' }) as any)
        .mockResolvedValueOnce({ slug: 'my-product' } as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        '/products/my-product'
      )
    })

    it('falls back to /products when slug lookup returns null', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')
      const mockSendEmail = vi.mocked(sendOrderAutoCancelledEmail)

      mockQueryOne.mockResolvedValueOnce(makeOrder({ order_type: 'direct' }) as any).mockResolvedValueOnce(null as any) // no slug
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        '/products'
      )
    })

    it('skips email when customer_email is null (auto_cancel_unpaid)', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')
      const mockSendEmail = vi.mocked(sendOrderAutoCancelledEmail)

      mockQueryOne.mockResolvedValue(
        makeOrder({ customer_email: null, users: { email: null, first_name: 'X', last_name: '' } }) as any
      )
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('creates auto task for auto_cancel_unpaid when user_id is present', async () => {
      const { createAutoTask } = await import('@/lib/auto-tasks')

      mockQueryOne.mockResolvedValue(makeOrder() as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(vi.mocked(createAutoTask)).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sourceKind: 'abandoned_checkout',
        })
      )
    })

    it('expectedUserId matching passes and allows cancellation', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ user_id: 'user-42' }) as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', {
        reason: 'user_request',
        expectedUserId: 'user-42',
      })

      expect(result).toMatchObject({ success: true })
    })
  })

  describe('cancel_requested path (paid / processing)', () => {
    it('sets status to cancel_requested for confirmed+paid order', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ status: 'confirmed', payment_status: 'paid' }) as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toEqual({
        success: true,
        directCancel: false,
        restoredToCart: false,
        cancelRequested: true,
      })
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'cancel_requested'"), ['order-1'])
    })

    it('sets status to cancel_requested for processing order', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ status: 'processing', payment_status: 'paid' }) as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: true, cancelRequested: true })
    })

    it('sets cancel_requested for pending order that has paid status', async () => {
      mockQueryOne.mockResolvedValue(makeOrder({ status: 'pending', payment_status: 'paid' }) as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: true, cancelRequested: true, directCancel: false })
    })

    it('sends sendOrderStatusUpdate email for cancel_requested path', async () => {
      const { sendOrderStatusUpdate } = await import('@/lib/email')

      mockQueryOne.mockResolvedValue(makeOrder({ status: 'confirmed', payment_status: 'paid' }) as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'user_request' })

      expect(vi.mocked(sendOrderStatusUpdate)).toHaveBeenCalledWith(
        'test@example.com',
        'Test User',
        'ORD-001',
        'order-1',
        'cancel_requested',
        'confirmed'
      )
    })

    it('skips sendOrderStatusUpdate when userEmail is missing', async () => {
      const { sendOrderStatusUpdate } = await import('@/lib/email')

      mockQueryOne.mockResolvedValue(
        makeOrder({
          status: 'confirmed',
          payment_status: 'paid',
          customer_email: null,
          users: { email: null, first_name: null, last_name: null },
        }) as any
      )
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'user_request' })

      expect(vi.mocked(sendOrderStatusUpdate)).not.toHaveBeenCalled()
    })

    it('skips logActivity in cancel_requested path when user_id is null', async () => {
      const { logActivity } = await import('@/lib/activity')

      mockQueryOne.mockResolvedValue(makeOrder({ status: 'confirmed', payment_status: 'paid', user_id: null }) as any)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'user_request' })

      expect(result).toMatchObject({ success: true, cancelRequested: true })
      expect(vi.mocked(logActivity)).not.toHaveBeenCalled()
    })

    it('uses customer_name when users object is null (cancel_requested path)', async () => {
      const { sendOrderStatusUpdate } = await import('@/lib/email')

      mockQueryOne.mockResolvedValue(
        makeOrder({
          status: 'confirmed',
          payment_status: 'paid',
          users: null,
          customer_name: 'Jane Doe',
          customer_email: 'jane@example.com',
        }) as any
      )
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'user_request' })

      expect(vi.mocked(sendOrderStatusUpdate)).toHaveBeenCalledWith(
        'jane@example.com',
        'Jane Doe',
        expect.any(String),
        expect.any(String),
        'cancel_requested',
        'confirmed'
      )
    })
  })

  describe('direct cancel — null user_id branches', () => {
    it('skips logActivity and createAutoTask when user_id is null (auto_cancel_unpaid)', async () => {
      const { logActivity } = await import('@/lib/activity')
      const { createAutoTask } = await import('@/lib/auto-tasks')

      mockQueryOne.mockResolvedValue(makeOrder({ user_id: null, order_type: null }) as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      const result = await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(result).toMatchObject({ success: true, directCancel: true })
      expect(vi.mocked(logActivity)).not.toHaveBeenCalled()
      expect(vi.mocked(createAutoTask)).not.toHaveBeenCalled()
    })

    it('order_type fallback to "cart" when order_type is null (auto_cancel_unpaid email)', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')

      mockQueryOne.mockResolvedValue(makeOrder({ order_type: null }) as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(vi.mocked(sendOrderAutoCancelledEmail)).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'cart', // fallback from null order_type
        expect.any(Number),
        expect.any(String)
      )
    })

    it('userName falls back to "Customer" when both user names and customer_name are empty (line 88)', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')

      // users present but both names empty string → trim() → '' → || 'Customer'
      mockQueryOne.mockResolvedValue(
        makeOrder({
          users: { email: 'test@example.com', first_name: '', last_name: '' },
          customer_name: '',
        }) as any
      )
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(vi.mocked(sendOrderAutoCancelledEmail)).toHaveBeenCalledWith(
        expect.any(String),
        'Customer', // the || 'Customer' fallback
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(String)
      )
    })

    it('uses customer_email when user.email is null (user?.email falsy branch, line 86)', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')

      // user object exists but email is null → user?.email is null (falsy) → || customer_email
      mockQueryOne.mockResolvedValue(
        makeOrder({
          users: { email: null, first_name: 'Jane', last_name: 'Doe' },
          customer_email: 'jane-customer@example.com',
        }) as any
      )
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(vi.mocked(sendOrderAutoCancelledEmail)).toHaveBeenCalledWith(
        'jane-customer@example.com', // fell through to customer_email
        'Jane Doe',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(String)
      )
    })

    it('uses customer_name when users is null in auto_cancel_unpaid path (line 86 ternary false)', async () => {
      const { sendOrderAutoCancelledEmail } = await import('@/lib/email')

      // users is null → user is null → ternary false branch → order.customer_name
      mockQueryOne.mockResolvedValue(
        makeOrder({
          users: null,
          customer_email: 'anon@example.com',
          customer_name: 'Anonymous Customer',
        }) as any
      )
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'auto_cancel_unpaid' })

      expect(vi.mocked(sendOrderAutoCancelledEmail)).toHaveBeenCalledWith(
        'anon@example.com',
        'Anonymous Customer',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(String)
      )
    })

    it('skips logActivity in direct-cancel path when user_id is null (user_request)', async () => {
      const { logActivity } = await import('@/lib/activity')

      mockQueryOne.mockResolvedValue(makeOrder({ user_id: null }) as any)
      mockQueryMany.mockResolvedValue([])
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

      await cancelOrder('order-1', { reason: 'user_request' })

      expect(vi.mocked(logActivity)).not.toHaveBeenCalled()
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Branch-gap tests: inventory.ts parseFloat truthy + ternary false paths
// ═════════════════════════════════════════════════════════════════════════════

describe('logStockMovement — parseFloat truthy branch (non-zero stock returned)', () => {
  it('uses actual non-zero stock from sub_variant lookup (truthy parseFloat path)', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 12 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, {
      productId: 'prod-1',
      variantId: 'var-1',
      subVariantId: 'sv-1',
      transactionType: 'sale',
      quantityChange: -3,
      referenceType: 'order',
      referenceId: 'ord-1',
    })

    const insertValues = mockQuery.mock.calls[0][1] as any[]
    expect(insertValues[5]).toBe(9) // 12 + (-3)
  })

  it('uses actual non-zero stock from variant lookup (truthy parseFloat path)', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 7 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, {
      productId: 'prod-1',
      variantId: 'var-1',
      transactionType: 'purchase',
      quantityChange: 5,
      referenceType: 'grn',
      referenceId: 'grn-1',
    })

    const insertValues = mockQuery.mock.calls[0][1] as any[]
    expect(insertValues[5]).toBe(12) // 7 + 5
  })

  it('uses actual non-zero stock from products table lookup (truthy parseFloat path)', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 20 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, {
      productId: 'prod-1',
      variantId: null,
      transactionType: 'adjustment',
      quantityChange: -5,
      referenceType: 'manual',
      referenceId: 'man-1',
    })

    const insertValues = mockQuery.mock.calls[0][1] as any[]
    expect(insertValues[5]).toBe(15) // 20 + (-5)
  })

  // Lines 34 & 38: the `|| 0` right-hand branch fires when parseFloat returns 0
  // (inventory_quantity is 0 — parseFloat(0) is falsy, so || 0 is taken)
  it('falls back to 0 when sub_variant inventory_quantity is zero (|| 0 branch, line 34)', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 0 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, {
      productId: 'prod-1',
      variantId: 'var-1',
      subVariantId: 'sv-zero',
      transactionType: 'sale',
      quantityChange: -1,
      referenceType: 'order',
      referenceId: 'ord-1',
    })

    const insertValues = mockQuery.mock.calls[0][1] as any[]
    expect(insertValues[5]).toBe(-1) // 0 + (-1)
  })

  it('falls back to 0 when variant inventory_quantity is zero (|| 0 branch, line 38)', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: 0 } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await logStockMovement(null, {
      productId: 'prod-1',
      variantId: 'var-zero',
      transactionType: 'purchase',
      quantityChange: 3,
      referenceType: 'grn',
      referenceId: 'grn-1',
    })

    const insertValues = mockQuery.mock.calls[0][1] as any[]
    expect(insertValues[5]).toBe(3) // 0 + 3
  })
})

describe('updateWeightedAvgCost — ternary false path (curStock + qtyReceived <= 0)', () => {
  it('uses unitCost when curStock is negative and sum <= 0 (variant path)', async () => {
    // curStock = -5, qtyReceived = 3  →  sum = -2 <= 0  →  newCost = unitCost
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: -5, cost_price: 100 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await updateWeightedAvgCost(mockClient, {
      productId: 'prod-1',
      variantId: 'var-1',
      qtyReceived: 3,
      unitCost: 80,
    })

    const updateCall = mockClient.query.mock.calls[1]
    expect(updateCall[1][0]).toBe(80)
  })

  it('uses unitCost when curStock is negative and sum <= 0 (product path)', async () => {
    // curStock = -10, qtyReceived = 5  →  sum = -5 <= 0  →  newCost = unitCost
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: -10, cost_price: 50 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await updateWeightedAvgCost(mockClient, {
      productId: 'prod-1',
      variantId: null,
      qtyReceived: 5,
      unitCost: 60,
    })

    const updateCall = mockClient.query.mock.calls[1]
    expect(updateCall[1][0]).toBe(60)
  })
})
