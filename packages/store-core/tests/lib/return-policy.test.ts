import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { getOrderItemsPolicy, checkReturnEligibility } from '@/lib/catalog/return-policy'
import { queryMany } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 'prod-1',
    product_name: 'Test Product',
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
    ...overrides,
  }
}

describe('getOrderItemsPolicy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns default policy when all source fields are null', async () => {
    mockQueryMany.mockResolvedValue([makeRow()])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.return_allowed).toBe(true)
    expect(policy.return_window_days).toBe(7)
    expect(policy.replacement_allowed).toBe(true)
    expect(policy.replacement_window_days).toBe(7)
    expect(policy.source).toBe('default')
  })

  it('uses brand policy when brand fields are set', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        brand_return_allowed: true,
        brand_return_window_days: 14,
        brand_replacement_allowed: true,
        brand_replacement_window_days: 14,
      }),
    ])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.return_window_days).toBe(14)
    expect(policy.source).toBe('brand')
  })

  it('uses category policy when only category fields set', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        category_return_allowed: true,
        category_return_window_days: 10,
        category_replacement_allowed: false,
        category_replacement_window_days: 5,
      }),
    ])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.return_window_days).toBe(10)
    expect(policy.replacement_allowed).toBe(false)
    expect(policy.source).toBe('category')
  })

  it('marks source as restrictive when many flags present', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        brand_return_allowed: false,
        brand_return_window_days: 3,
        category_return_allowed: false,
        category_return_window_days: 5,
        parent_return_allowed: false,
        parent_return_window_days: 7,
      }),
    ])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.source).toBe('restrictive')
  })

  it('return_allowed is false when any flag is false', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        brand_return_allowed: true,
        brand_return_window_days: 10,
        category_return_allowed: false,
        category_return_window_days: 5,
      }),
    ])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.return_allowed).toBe(false)
  })

  it('picks minimum window across sources', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        brand_return_allowed: true,
        brand_return_window_days: 14,
        category_return_allowed: true,
        category_return_window_days: 5,
      }),
    ])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.return_window_days).toBe(5)
  })

  it('returns empty array when no items', async () => {
    mockQueryMany.mockResolvedValue([])
    const policies = await getOrderItemsPolicy('order-empty')
    expect(policies).toHaveLength(0)
  })

  it('uses parent_category source when only parent fields set', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        parent_return_allowed: true,
        parent_return_window_days: 3,
      }),
    ])
    const [policy] = await getOrderItemsPolicy('order-1')
    expect(policy.source).toBe('parent_category')
  })
})

describe('checkReturnEligibility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok:false when no items', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await checkReturnEligibility('order-empty', 'refund', new Date())
    expect(result.ok).toBe(false)
    expect((result as any).reason).toContain('no items')
  })

  it('returns ok:false when return is not allowed for a product', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        brand_return_allowed: false,
        brand_return_window_days: 7,
      }),
    ])
    const result = await checkReturnEligibility('order-1', 'refund', new Date())
    expect(result.ok).toBe(false)
    expect((result as any).reason).toContain('not allowed')
  })

  it('returns ok:false when replacement is not allowed', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({
        brand_replacement_allowed: false,
        brand_replacement_window_days: 7,
      }),
    ])
    const result = await checkReturnEligibility('order-1', 'replacement', new Date())
    expect(result.ok).toBe(false)
    expect((result as any).reason).toContain('not allowed')
  })

  it('returns ok:false when window has expired', async () => {
    mockQueryMany.mockResolvedValue([makeRow()])
    // delivered 30 days ago, window is 7 days
    const deliveredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = await checkReturnEligibility('order-1', 'refund', deliveredAt)
    expect(result.ok).toBe(false)
    expect((result as any).reason).toContain('window has closed')
  })

  it('returns ok:true with effectiveWindowDays within window', async () => {
    mockQueryMany.mockResolvedValue([makeRow()])
    // delivered 1 day ago, default window is 7 days
    const deliveredAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    const result = await checkReturnEligibility('order-1', 'refund', deliveredAt)
    expect(result.ok).toBe(true)
    expect((result as { ok: true; effectiveWindowDays: number }).effectiveWindowDays).toBe(7)
  })

  it('uses minimum window across items for eligibility', async () => {
    mockQueryMany.mockResolvedValue([
      makeRow({ product_id: 'p1', product_name: 'A', brand_return_allowed: true, brand_return_window_days: 3 }),
      makeRow({ product_id: 'p2', product_name: 'B', category_return_allowed: true, category_return_window_days: 14 }),
    ])
    // delivered 4 days ago, effective window = min(3,7,7) depends on source
    // p1 brand window = 3, p2 default = 7 → min = 3
    const deliveredAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    const result = await checkReturnEligibility('order-1', 'refund', deliveredAt)
    expect(result.ok).toBe(false)
    expect((result as any).reason).toContain('3 day')
  })
})
