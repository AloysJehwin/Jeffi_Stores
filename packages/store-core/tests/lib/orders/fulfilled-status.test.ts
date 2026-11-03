import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  FULFILLED_STATUSES,
  isFulfilledStatus,
  fulfilledSql,
  FULFILLED_SQL,
  settledAtSql,
  SETTLED_AT_SQL,
} from '@/lib/orders/fulfilled-status'

describe('fulfilled-status', () => {
  it('treats delivered and granted as fulfilled, nothing else', () => {
    expect(FULFILLED_STATUSES).toEqual(['delivered', 'granted'])
    expect(isFulfilledStatus('delivered')).toBe(true)
    expect(isFulfilledStatus('granted')).toBe(true)
    for (const s of ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'cancelled', '', null, undefined]) {
      expect(isFulfilledStatus(s as any)).toBe(false)
    }
  })

  it('builds a SQL predicate with the given alias', () => {
    expect(fulfilledSql('o')).toBe("o.status IN ('delivered', 'granted')")
    expect(fulfilledSql('orders')).toBe("orders.status IN ('delivered', 'granted')")
    expect(fulfilledSql('')).toBe("status IN ('delivered', 'granted')")
    expect(FULFILLED_SQL).toBe("o.status IN ('delivered', 'granted')")
  })

  it('coalesces delivered_at then granted_at then created_at for the settled timestamp', () => {
    expect(settledAtSql('o')).toBe('COALESCE(o.delivered_at, o.granted_at, o.created_at)')
    expect(settledAtSql('')).toBe('COALESCE(delivered_at, granted_at, created_at)')
    expect(SETTLED_AT_SQL).toBe('COALESCE(o.delivered_at, o.granted_at, o.created_at)')
  })
})
