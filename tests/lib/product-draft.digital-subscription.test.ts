import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn() as any
const mockWithTransaction = vi.fn()

vi.mock('@/lib/shared/db', () => ({
  query: async () => ({ rows: [] }),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  queryMany: (...args: any[]) => mockQueryMany(...args),
  withTransaction: (...args: any[]) => mockWithTransaction(...args),
}))

const mockRecompute = vi.fn()
vi.mock('@/lib/orders/inventory', () => ({
  recomputeStockStatusForProduct: (...args: any[]) => mockRecompute(...args),
}))

import { publishProductDraft } from '@/lib/catalog/product-draft'

function fields(over: Record<string, unknown> = {}) {
  return {
    name: 'P',
    sku: 'S',
    slug: 's',
    base_price: '100',
    has_variants: false,
    perishable: false,
    serialized: false,
    is_digital: false,
    is_subscription: true,
    stock_status: 'In Stock',
    ...over,
  }
}

function run(draft: Record<string, unknown>) {
  mockQueryOne.mockResolvedValueOnce({
    product_id: 'p1',
    images: [],
    sub_variants: [],
    units: [],
    variants: [],
    ...draft,
  })
  mockQueryMany.mockResolvedValue([])
  mockWithTransaction.mockImplementation(async (fn: any) => fn({ query: mockClientQuery }))
  mockClientQuery.mockImplementation(async (sql: string) =>
    String(sql).includes('COUNT(*)') ? { rows: [{ count: '0' }] } : { rows: [], rowCount: 0 }
  )
  return publishProductDraft('p1')
}

const sqls = (): string[] => mockClientQuery.mock.calls.map((c: any[]) => String(c[0]))
const productUpdateJson = () => {
  const call = mockClientQuery.mock.calls.find((c: any[]) => String(c[0]).includes('subscription_total_cycles'))
  return JSON.parse(call[1][1])
}

describe('publishProductDraft — digital normalization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeroes stock, drops tracking and selling units for a digital product', async () => {
    await run({
      fields: fields({
        is_digital: true,
        perishable: true,
        serialized: true,
        inventory_sync: true,
        sell_unit_id: 'u1',
      }),
      units: [{ unit: 'box', factor: 10, is_base: true }],
    })
    const json = productUpdateJson()
    expect(json).toMatchObject({
      perishable: false,
      serialized: false,
      inventory_sync: false,
      has_variants: false,
      stock_status: 'In Stock',
      sell_unit_id: null,
    })
    const all = sqls()
    expect(all.some(s => s.includes('INSERT INTO product_units'))).toBe(false)
    expect(all).toContain('DELETE FROM product_units WHERE product_id = $1')
    expect(all).toContain('DELETE FROM shelf_stock WHERE product_id = $1')
    expect(all).toContain('DELETE FROM product_batches WHERE product_id = $1')
    const zero = all.findIndex(s => s.includes("inventory_quantity = 0, stock_status = 'In Stock'"))
    expect(zero).toBeGreaterThan(-1)
    // Normalization runs before the stock-status recompute.
    expect(mockRecompute).toHaveBeenCalled()
    expect(mockClientQuery.mock.invocationCallOrder[zero]).toBeLessThan(mockRecompute.mock.invocationCallOrder[0])
  })

  it('leaves a physical product untouched', async () => {
    await run({ fields: fields({ perishable: true }) })
    expect(sqls()).not.toContain('DELETE FROM product_units WHERE product_id = $1')
    expect(productUpdateJson().perishable).toBe(true)
  })
})

describe('publishProductDraft — subscription pricing & cycles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps a simple product subscription price and cycle limits', async () => {
    await run({
      fields: fields({ subscription_price: '99.456', subscription_total_cycles: '12', subscription_min_cycles: 3 }),
    })
    expect(productUpdateJson()).toMatchObject({
      subscription_price: 99.46,
      subscription_total_cycles: 12,
      subscription_min_cycles: 3,
    })
  })

  it('clears the product-level price on a variant product and normalizes variant prices', async () => {
    await run({
      fields: fields({ has_variants: true, subscription_price: '50' }),
      variants: [
        { sku: 'S-A', variant_name: 'A', subscription_price: '45' },
        { sku: 'S-B', variant_name: 'B', subscription_price: 'abc' },
      ],
    })
    expect(productUpdateJson().subscription_price).toBeNull()
    const upsert = mockClientQuery.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO product_variants'))
    expect(String(upsert[0])).toContain('subscription_price = EXCLUDED.subscription_price')
    const rows = JSON.parse(upsert[1][1])
    expect(rows.map((v: any) => v.subscription_price)).toEqual([45, null])
  })

  it('writes an edited sub-variant subscription price', async () => {
    const sv = {
      id: '11111111-1111-4111-8111-111111111111',
      variant_id: 'v1',
      sub_variant_name: 'Red',
      sku: 'S-A-RED',
      subscription_price: 30,
      _edited: true,
    }
    await run({
      fields: fields({ has_variants: true }),
      variants: [{ sku: 'S-A', variant_name: 'A' }],
      sub_variants: [sv],
    })
    const upd = mockClientQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE product_sub_variants SET\n')
    )
    expect(String(upd[0])).toContain('subscription_price = $18')
    expect(upd[1][17]).toBe(30)
  })

  it('publishes per-interval prices: product map normalized, kept when absent, cleared on variant products', async () => {
    await run({ fields: fields({ subscription_prices: { monthly: '499', yearly: '4999.999', weekly: '' } }) })
    expect(productUpdateJson().subscription_prices).toEqual({ monthly: 499, yearly: 5000 })
    const upd = mockClientQuery.mock.calls.find((c: any[]) => String(c[0]).includes('subscription_total_cycles'))
    expect(String(upd[0])).toContain("ELSE subscription_prices END")
    vi.clearAllMocks()
    await run({ fields: fields() })
    expect('subscription_prices' in productUpdateJson()).toBe(false)
    vi.clearAllMocks()
    await run({
      fields: fields({ has_variants: true, subscription_prices: { monthly: '9' } }),
      variants: [{ sku: 'S-A', variant_name: 'A', subscription_prices: { quarterly: '1200', daily: 3 } }],
    })
    expect(productUpdateJson().subscription_prices).toEqual({})
    const upsert = mockClientQuery.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO product_variants'))
    expect(String(upsert[0])).toContain('subscription_prices = EXCLUDED.subscription_prices')
    expect(JSON.parse(upsert[1][1])[0].subscription_prices).toEqual({ quarterly: 1200 })
  })

  it('writes edited sub-variant interval prices, keeping stored ones when the draft row lacks them', async () => {
    const base = { variant_id: 'v1', sub_variant_name: 'Red', sku: 'S-A-RED', _edited: true }
    await run({
      fields: fields({ has_variants: true }),
      variants: [{ sku: 'S-A', variant_name: 'A' }],
      sub_variants: [
        { ...base, id: '11111111-1111-4111-8111-111111111111', subscription_prices: { monthly: '80' } },
        { ...base, id: '22222222-2222-4222-8222-222222222222', sku: 'S-A-BLUE', sub_variant_name: 'Blue' },
      ],
    })
    const upds = mockClientQuery.mock.calls.filter((c: any[]) =>
      String(c[0]).includes('UPDATE product_sub_variants SET\n')
    )
    expect(String(upds[0][0])).toContain('subscription_prices = COALESCE($19::jsonb, subscription_prices)')
    expect(upds.map((c: any[]) => c[1][18])).toEqual([JSON.stringify({ monthly: 80 }), null])
  })

  it('rejects a minimum above the number of cycles', async () => {
    await expect(run({ fields: fields({ subscription_total_cycles: 3, subscription_min_cycles: 6 }) })).rejects.toThrow(
      'Minimum billing cycles cannot exceed'
    )
  })
})
