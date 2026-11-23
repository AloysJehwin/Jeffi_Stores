import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { getBusinessDiscountPct, getBusinessDiscountMap, applyBusinessDiscount } from '@/lib/catalog/business-discount'
import { queryOne, queryMany } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => {
  mockQueryOne.mockReset()
  mockQueryMany.mockReset()
})

describe('applyBusinessDiscount (re-exported applyDiscount)', () => {
  it('applies the percentage', () => {
    expect(applyBusinessDiscount(100, 25)).toBe(75)
  })
})

describe('getBusinessDiscountPct', () => {
  it('parses the row discount', async () => {
    mockQueryOne.mockResolvedValue({ discount_pct: '12.5' } as any)
    expect(await getBusinessDiscountPct('u1', 'c1')).toBe(12.5)
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('FROM business_discounts WHERE user_id=$1 AND category_id=$2')
    expect(params).toEqual(['u1', 'c1'])
  })
  it('returns 0 when no row', async () => {
    mockQueryOne.mockResolvedValue(null as any)
    expect(await getBusinessDiscountPct('u1', 'c1')).toBe(0)
  })
})

describe('getBusinessDiscountMap', () => {
  it('maps category_id → parsed pct', async () => {
    mockQueryMany.mockResolvedValue([
      { category_id: 'c1', discount_pct: '10' },
      { category_id: 'c2', discount_pct: '7.5' },
    ] as any)
    expect(await getBusinessDiscountMap('u1')).toEqual({ c1: 10, c2: 7.5 })
    expect(mockQueryMany.mock.calls[0][1]).toEqual(['u1'])
  })
  it('empty object for no rows', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    expect(await getBusinessDiscountMap('u1')).toEqual({})
  })
})
