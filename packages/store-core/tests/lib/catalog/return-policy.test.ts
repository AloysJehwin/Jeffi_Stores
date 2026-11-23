import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { getOrderItemsPolicy, checkReturnEligibility } from '@/lib/catalog/return-policy'
import { queryMany } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)

const baseRow = (over: Record<string, any> = {}) => ({
  product_id: 'p1',
  product_name: 'Widget',
  product_return_window_days: null,
  brand_return_allowed: null,
  brand_return_window_days: null,
  brand_replacement_allowed: null,
  brand_replacement_window_days: null,
  category_return_allowed: null,
  category_return_window_days: null,
  category_replacement_allowed: null,
  category_replacement_window_days: null,
  parent_return_allowed: null,
  parent_return_window_days: null,
  parent_replacement_allowed: null,
  parent_replacement_window_days: null,
  ...over,
})

beforeEach(() => mockQueryMany.mockReset())

describe('getOrderItemsPolicy', () => {
  it('queries order_items and maps resolved policies', async () => {
    mockQueryMany.mockResolvedValue([baseRow({ product_return_window_days: 10 })] as any)
    const out = await getOrderItemsPolicy('o1')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ product_id: 'p1', product_name: 'Widget', return_window_days: 10, source: 'product' })
    const [sql, params] = mockQueryMany.mock.calls[0]
    expect(sql).toContain('FROM order_items oi')
    expect(params).toEqual(['o1'])
  })
})

describe('checkReturnEligibility', () => {
  const soon = new Date() // delivered now → inside any positive window

  it('fails when the order has no items', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    const r = await checkReturnEligibility('o1', 'refund', soon)
    expect(r).toEqual({ ok: false, reason: 'Order has no items' })
  })

  it('fails when selected ids match nothing', async () => {
    mockQueryMany.mockResolvedValue([baseRow({ product_return_window_days: 10 })] as any)
    const r = await checkReturnEligibility('o1', 'refund', soon, ['other'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/None of the selected items/)
  })

  it('blocks a refund when a product disallows returns', async () => {
    mockQueryMany.mockResolvedValue([baseRow({ product_return_window_days: 0, product_name: 'NoReturn' })] as any)
    const r = await checkReturnEligibility('o1', 'refund', soon)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Returns are not allowed for "NoReturn"/)
  })

  it('blocks a replacement when disallowed', async () => {
    mockQueryMany.mockResolvedValue([
      baseRow({ brand_replacement_allowed: false, brand_return_allowed: true, product_name: 'NoRepl' }),
    ] as any)
    const r = await checkReturnEligibility('o1', 'replacement', soon)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Replacements are not allowed for "NoRepl"/)
  })

  it('fails when the window has closed', async () => {
    mockQueryMany.mockResolvedValue([baseRow({ product_return_window_days: 7 })] as any)
    const delivered = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    const r = await checkReturnEligibility('o1', 'refund', delivered)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/window has closed/)
      expect(r.reason).toMatch(/7 days/)
    }
  })

  it('singular day in the closed-window message', async () => {
    mockQueryMany.mockResolvedValue([baseRow({ product_return_window_days: 1 })] as any)
    const delivered = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const r = await checkReturnEligibility('o1', 'refund', delivered)
    if (!r.ok) expect(r.reason).toMatch(/1 day from delivery/)
  })

  it('succeeds within the window and reports the effective window', async () => {
    mockQueryMany.mockResolvedValue([
      baseRow({ product_return_window_days: 7 }),
      baseRow({ product_id: 'p2', product_return_window_days: 5 }),
    ] as any)
    const r = await checkReturnEligibility('o1', 'refund', soon)
    expect(r).toEqual({ ok: true, effectiveWindowDays: 5 }) // min of 7,5
  })

  it('scopes to the submitted item ids', async () => {
    mockQueryMany.mockResolvedValue([
      baseRow({ product_id: 'p1', product_return_window_days: 7 }),
      baseRow({ product_id: 'p2', product_return_window_days: 2 }),
    ] as any)
    const r = await checkReturnEligibility('o1', 'refund', soon, ['p1'])
    expect(r).toEqual({ ok: true, effectiveWindowDays: 7 })
  })
})
