import { describe, expect, it } from 'vitest'
import { unitConversion } from '@/lib/orders/unit-conversion'

describe('unitConversion', () => {
  it('shows pieces per selling unit and the total', () => {
    expect(unitConversion('2.000', 'set', '10.000000')).toEqual({ perUnit: '1 SET = 10 PCS', total: '20 PCS' })
  })
  it('handles fractional factors', () => {
    expect(unitConversion(3, 'box', 2.5)).toEqual({ perUnit: '1 BOX = 2.5 PCS', total: '7.5 PCS' })
  })
  it('is null for pieces, missing units or factor <= 1', () => {
    expect(unitConversion(5, 'pcs', 10)).toBeNull()
    expect(unitConversion(5, null, 10)).toBeNull()
    expect(unitConversion(5, 'set', 1)).toBeNull()
    expect(unitConversion(5, 'set', null)).toBeNull()
  })
})
