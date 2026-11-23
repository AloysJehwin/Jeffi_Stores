import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

import { deleteProductCascadeTx, productHasHistory, retireProduct } from '@/lib/catalog/product-delete'
import { query, withTransaction } from '@/lib/shared/db'

const mQuery = vi.mocked(query)
const mTx = vi.mocked(withTransaction)

beforeEach(() => vi.clearAllMocks())

describe('deleteProductCascadeTx', () => {
  it('clears restricting references then the product, in order, all by product id', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) }
    await deleteProductCascadeTx(client as any, 'p1')
    const sqls = client.query.mock.calls.map(c => String(c[0]))
    expect(sqls[0]).toContain('DELETE FROM grn_items')
    expect(sqls[1]).toContain('DELETE FROM purchase_order_items')
    expect(sqls[2]).toContain('DELETE FROM shelf_stock_transactions')
    expect(sqls[3]).toContain('DELETE FROM shelf_stock')
    expect(sqls[4]).toContain('DELETE FROM business_rfq_items')
    expect(sqls[5]).toContain('DELETE FROM products WHERE id = $1')
    // products must be deleted last
    expect(sqls[sqls.length - 1]).toContain('DELETE FROM products')
    expect(client.query.mock.calls.every(c => c[1][0] === 'p1')).toBe(true)
    // grn + po deletes also match the product's variant ids
    expect(sqls[0]).toContain('variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)')
    expect(sqls[1]).toContain('variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)')
  })
})

describe('productHasHistory', () => {
  it('true when order/PO history exists', async () => {
    mQuery.mockResolvedValueOnce({ rows: [{ n: '3' }] } as any)
    expect(await productHasHistory('p1')).toBe(true)
    const [sql, args] = mQuery.mock.calls[0]
    expect(sql).toContain('order_items')
    expect(sql).toContain('purchase_order_items')
    expect(args).toEqual(['p1'])
  })

  it('false when the count is zero', async () => {
    mQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] } as any)
    expect(await productHasHistory('p1')).toBe(false)
  })

  it('false when the row is missing', async () => {
    mQuery.mockResolvedValueOnce({ rows: [] } as any)
    expect(await productHasHistory('p1')).toBe(false)
  })
})

describe('retireProduct', () => {
  it('deactivates a product with history and never deletes', async () => {
    mQuery.mockResolvedValueOnce({ rows: [{ n: '2' }] } as any) // productHasHistory
    mQuery.mockResolvedValueOnce({} as any) // UPDATE
    const r = await retireProduct('p1')
    expect(r).toBe('deactivated')
    const update = mQuery.mock.calls[1]
    expect(String(update[0])).toContain('UPDATE products SET is_active = false')
    expect(update[1]).toEqual(['p1'])
    expect(mTx).not.toHaveBeenCalled()
  })

  it('hard-deletes a product without history', async () => {
    mQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] } as any) // no history
    mTx.mockResolvedValueOnce(undefined as any)
    const r = await retireProduct('p1')
    expect(r).toBe('deleted')
    expect(mTx).toHaveBeenCalledWith(expect.any(Function))
    // The tx callback runs the cascade for p1
    const client = { query: vi.fn().mockResolvedValue({}) }
    await mTx.mock.calls[0][0](client as any)
    expect(client.query.mock.calls.some(c => String(c[0]).includes('DELETE FROM products WHERE id = $1'))).toBe(true)
  })
})
