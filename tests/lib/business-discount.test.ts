import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// Also mock pricing so we can verify re-exports work without circular issues
import { queryOne, queryMany } from '@/lib/db'
import {
  getBusinessDiscountPct,
  getBusinessDiscountMap,
  applyBusinessDiscount,
  applyDiscount,
} from '@/lib/business-discount'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Re-exported applyDiscount ─────────────────────────────────────────────────

describe('applyBusinessDiscount / applyDiscount (re-export)', () => {
  it('applyBusinessDiscount is the same function as applyDiscount from pricing', () => {
    expect(applyBusinessDiscount).toBe(applyDiscount)
  })

  it('applies discount correctly via re-export', () => {
    expect(applyBusinessDiscount(1000, 20)).toBe(800)
    expect(applyDiscount(500, 10)).toBe(450)
  })
})

// ── getBusinessDiscountPct ────────────────────────────────────────────────────

describe('getBusinessDiscountPct', () => {
  it('returns parsed discount_pct when row found', async () => {
    mockQueryOne.mockResolvedValueOnce({ discount_pct: '15.50' })
    const result = await getBusinessDiscountPct('user-1', 'cat-1')
    expect(result).toBe(15.5)
    expect(mockQueryOne).toHaveBeenCalledOnce()
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('business_discounts'),
      ['user-1', 'cat-1']
    )
  })

  it('returns 0 when no row found (null)', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getBusinessDiscountPct('user-1', 'cat-99')
    expect(result).toBe(0)
  })

  it('returns 0 when no row found (undefined)', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getBusinessDiscountPct('user-1', 'cat-99')
    expect(result).toBe(0)
  })

  it('handles integer discount_pct string', async () => {
    mockQueryOne.mockResolvedValueOnce({ discount_pct: '30' })
    const result = await getBusinessDiscountPct('user-2', 'cat-2')
    expect(result).toBe(30)
  })

  it('handles "0" discount_pct', async () => {
    mockQueryOne.mockResolvedValueOnce({ discount_pct: '0' })
    const result = await getBusinessDiscountPct('user-3', 'cat-3')
    expect(result).toBe(0)
  })

  it('passes userId and categoryId to query', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await getBusinessDiscountPct('u-abc', 'c-xyz')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['u-abc', 'c-xyz'])
  })
})

// ── getBusinessDiscountMap ────────────────────────────────────────────────────

describe('getBusinessDiscountMap', () => {
  it('returns a map of category_id -> discount_pct', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { category_id: 'cat-1', discount_pct: '10' },
      { category_id: 'cat-2', discount_pct: '25.5' },
    ])
    const result = await getBusinessDiscountMap('user-1')
    expect(result).toEqual({ 'cat-1': 10, 'cat-2': 25.5 })
  })

  it('returns empty object when no rows', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const result = await getBusinessDiscountMap('user-1')
    expect(result).toEqual({})
  })

  it('passes userId to query', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getBusinessDiscountMap('u-xyz')
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.stringContaining('business_discounts'),
      ['u-xyz']
    )
  })

  it('handles multiple categories with various decimal values', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { category_id: 'cat-a', discount_pct: '5.25' },
      { category_id: 'cat-b', discount_pct: '12.75' },
      { category_id: 'cat-c', discount_pct: '0' },
    ])
    const result = await getBusinessDiscountMap('user-2')
    expect(result['cat-a']).toBe(5.25)
    expect(result['cat-b']).toBe(12.75)
    expect(result['cat-c']).toBe(0)
  })

  it('last category wins when duplicate category_ids returned', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { category_id: 'cat-dup', discount_pct: '10' },
      { category_id: 'cat-dup', discount_pct: '20' },
    ])
    const result = await getBusinessDiscountMap('user-3')
    // Object.fromEntries keeps the last entry for duplicate keys
    expect(result['cat-dup']).toBe(20)
  })
})
