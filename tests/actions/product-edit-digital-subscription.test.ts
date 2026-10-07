import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;/' })
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/tenancy/get-host', () => ({ getHost: vi.fn(async () => 'localhost') }))
vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))
vi.mock('@/lib/auth/admin-auth', () => ({ getAdminSession: vi.fn(async () => null) }))
vi.mock('@/lib/catalog/product-draft', () => ({
  publishProductDraft: vi.fn(),
  openOrdersForProduct: vi.fn(async () => []),
}))
vi.mock('@/lib/shared/google-sheets', () => ({ syncProductToSheet: vi.fn(async () => {}) }))
vi.mock('@/lib/merchant/sync', () => ({ syncProductToMerchant: vi.fn(async () => {}) }))
vi.mock('@/lib/amazon/sync', () => ({ syncProductToAmazon: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  queryOne: vi.fn(async () => null),
  queryMany: vi.fn(async () => []),
}))

import { query, queryOne } from '@/lib/shared/db'
import { updateProduct } from '@/app/(admin)/admin/products/edit/[id]/actions'

const PID = '11111111-1111-4111-8111-111111111111'

function form(over: Record<string, string> = {}) {
  const fd = new FormData()
  const base: Record<string, string> = {
    name: 'E-book',
    description: '',
    category_id: '22222222-2222-4222-8222-222222222222',
    base_price: '100',
    gst_percentage: '18',
    stock_status: 'Out of Stock',
    intent: 'draft-stay',
    is_active: 'true',
    ...over,
  }
  for (const [k, v] of Object.entries(base)) fd.set(k, v)
  return fd
}

const sqls = () => vi.mocked(query).mock.calls.map(c => String(c[0]))
const productUpdate = () => vi.mocked(query).mock.calls.find(c => String(c[0]).startsWith('UPDATE products SET name'))!

describe('updateProduct (live edit)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('normalizes a digital product: no tracking, In Stock, units and stock cleared', async () => {
    await expect(
      updateProduct(PID, form({ is_digital: 'true', perishable: 'true', serialized: 'true', inventory_sync: 'true' }))
    ).rejects.toThrow('NEXT_REDIRECT')
    const [, params] = productUpdate()
    expect(params).toContain('In Stock')
    const all = sqls()
    expect(all).toContain('DELETE FROM product_units WHERE product_id = $1')
    expect(all).toContain('DELETE FROM shelf_stock WHERE product_id = $1')
    expect(all.some(s => s.includes("inventory_quantity = 0, stock_status = 'In Stock'"))).toBe(true)
    const setSql = String(productUpdate()[0])
    const perishableIdx = setSql.match(/perishable = \$(\d+)/)![1]
    const serializedIdx = setSql.match(/serialized = \$(\d+)/)![1]
    expect((params as unknown[])[Number(perishableIdx) - 1]).toBe(false)
    expect((params as unknown[])[Number(serializedIdx) - 1]).toBe(false)
  })

  it('leaves a physical product alone', async () => {
    await expect(updateProduct(PID, form())).rejects.toThrow('NEXT_REDIRECT')
    expect(sqls()).not.toContain('DELETE FROM product_units WHERE product_id = $1')
  })

  it('saves product-level subscription price and cycle limits', async () => {
    await expect(
      updateProduct(
        PID,
        form({
          is_subscription: 'true',
          subscription_price: '89.999',
          subscription_total_cycles: '12',
          subscription_min_cycles: '3',
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT')
    const [sql, params] = productUpdate()
    const at = (col: string) =>
      (params as unknown[])[Number(String(sql).match(new RegExp(`${col} = \\$(\\d+)`))![1]) - 1]
    expect(at('subscription_price')).toBe(90)
    expect(at('subscription_total_cycles')).toBe(12)
    expect(at('subscription_min_cycles')).toBe(3)
  })

  it('saves product-level per-interval subscription prices, dropping blanks and junk', async () => {
    await expect(
      updateProduct(
        PID,
        form({
          is_subscription: 'true',
          subscription_intervals: 'monthly,yearly',
          subscription_prices: JSON.stringify({ monthly: '499', yearly: '4999.999', weekly: '', daily: '5' }),
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT')
    const [sql, params] = productUpdate()
    const idx = Number(String(sql).match(/subscription_prices = \$(\d+)/)![1]) - 1
    expect(JSON.parse((params as unknown[])[idx] as string)).toEqual({ monthly: 499, yearly: 5000 })
  })

  it('rejects a minimum above the number of cycles', async () => {
    const r = await updateProduct(
      PID,
      form({ is_subscription: 'true', subscription_total_cycles: '3', subscription_min_cycles: '5' })
    )
    expect(r).toEqual({ error: 'Minimum billing cycles cannot exceed the number of billing cycles' })
    expect(query).not.toHaveBeenCalled()
  })

  it('writes variant and sub-variant subscription prices', async () => {
    vi.mocked(queryOne).mockImplementation(
      async (sql: string) => (String(sql).includes('SELECT sku FROM products') ? { sku: 'EB' } : null) as any
    )
    const variants = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        variant_name: 'A',
        price: '100',
        subscription_price: '80',
        subscription_prices: { monthly: '75', yearly: '800' },
      },
      { id: 'temp-1', variant_name: 'B', price: '120', subscription_price: '' },
    ]
    const subs = [
      {
        variant_id: variants[0].id,
        id: '44444444-4444-4444-8444-444444444444',
        subscription_price: '70',
        subscription_prices: { quarterly: '200' },
      },
    ]
    await expect(
      updateProduct(
        PID,
        form({
          has_variants: 'true',
          is_subscription: 'true',
          subscription_price: '50',
          variants_json: JSON.stringify(variants),
          sub_variant_subscription_prices: JSON.stringify(subs),
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT')
    const [sql, params] = productUpdate()
    const at = (col: string) =>
      (params as unknown[])[Number(String(sql).match(new RegExp(`${col} = \\$(\\d+)`))![1]) - 1]
    expect(at('subscription_price')).toBeNull() // variant products price per variant
    const upd = vi.mocked(query).mock.calls.find(c => String(c[0]).startsWith('UPDATE product_variants SET sku'))!
    expect((upd[1] as unknown[])[24]).toBe(80)
    expect(JSON.parse((upd[1] as unknown[])[25] as string)).toEqual({ monthly: 75, yearly: 800 })
    const ins = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO product_variants'))!
    expect((ins[1] as unknown[])[23]).toBeNull()
    expect((ins[1] as unknown[])[24]).toBe('{}')
    const sv = vi
      .mocked(query)
      .mock.calls.find(c => /UPDATE product_sub_variants\s+SET subscription_price/.test(String(c[0])))!
    expect(sv[1]).toEqual([70, subs[0].id, PID, JSON.stringify({ quarterly: 200 })])
    const [psql, pparams] = productUpdate()
    const pidx = Number(String(psql).match(/subscription_prices = \$(\d+)/)![1]) - 1
    expect((pparams as unknown[])[pidx]).toBe('{}')
  })
})
