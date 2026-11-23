import { describe, it, expect, vi } from 'vitest'

const db = vi.hoisted(() => ({ queryMany: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)

import { cartMoqProblem, buyNowMoqProblem } from '@/lib/orders/moq-check'

// Real moqError is used (not mocked), so expectations are hand-computed from it.

describe('cartMoqProblem', () => {
  it('returns null when every line meets its MOQ', async () => {
    // qty 10 * factor 1 = 10 >= moq 5
    db.queryMany.mockResolvedValueOnce([{ name: 'Bolt', moq: 5, qty: 10, factor: 1, dimension: 'count' }])
    const r = await cartMoqProblem('user-1')
    expect(r).toBeNull()
    const [sql, params] = db.queryMany.mock.calls[0]
    expect(sql).toContain('FROM cart_items ci')
    expect(sql).toContain('saved_for_later')
    expect(sql).toContain('p.moq > 1')
    expect(params).toEqual(['user-1'])
  })

  it('names the first line below MOQ with the computed message', async () => {
    // line1 ok (count dim, qty 10>=5); line2 below: 2*1=2 < 5
    db.queryMany.mockResolvedValueOnce([
      { name: 'Bolt', moq: 5, qty: 10, factor: 1, dimension: 'count' },
      { name: 'Nut', moq: 5, qty: 2, factor: 1, dimension: 'count' },
    ])
    const r = await cartMoqProblem('user-1')
    expect(r).toBe('Nut: Minimum order for business buyers is 5 pieces.')
  })

  it('computes the packs form when factor > 1', async () => {
    // 1 pack * factor 4 = 4 < moq 10; units = ceil(10/4) = 3
    db.queryMany.mockResolvedValueOnce([{ name: 'Pack', moq: 10, qty: 1, factor: 4, dimension: 'count' }])
    const r = await cartMoqProblem('user-1')
    expect(r).toBe('Pack: Minimum order for business buyers is 10 pieces (3 packs).')
  })

  it('ignores measured (non-count) dimensions', async () => {
    db.queryMany.mockResolvedValueOnce([{ name: 'Wire', moq: 10, qty: 1, factor: 1, dimension: 'length' }])
    expect(await cartMoqProblem('user-1')).toBeNull()
  })
})

describe('buyNowMoqProblem', () => {
  it('passes the buy-now params and returns null when fine', async () => {
    db.queryMany.mockResolvedValueOnce([{ name: 'Bolt', moq: 5, qty: 10, factor: 1, dimension: 'count' }])
    const r = await buyNowMoqProblem({ productId: 'p1', variantId: 'v1', subVariantId: 's1', qty: 10, buyUnit: 'pack' })
    expect(r).toBeNull()
    const [sql, params] = db.queryMany.mock.calls[0]
    expect(sql).toContain('FROM products p')
    expect(sql).toContain('p.id = $1 AND p.moq > 1')
    expect(params).toEqual(['p1', 10, 'pack', 'v1', 's1'])
  })

  it('reports a below-MOQ buy now', async () => {
    db.queryMany.mockResolvedValueOnce([{ name: 'Bolt', moq: 12, qty: 3, factor: 1, dimension: 'count' }])
    const r = await buyNowMoqProblem({ productId: 'p1', variantId: null, subVariantId: null, qty: 3, buyUnit: null })
    expect(r).toBe('Bolt: Minimum order for business buyers is 12 pieces.')
  })
})
