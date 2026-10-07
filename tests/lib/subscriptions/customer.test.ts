import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { queryMany } from '@/lib/shared/db'
import { loadCustomerSubscriptions } from '@/lib/subscriptions/customer'

const row = (o: Record<string, unknown>) => ({
  id: 's1',
  status: 'active',
  product_id: 'p1',
  product_name: 'Coffee',
  product_slug: 'coffee',
  interval: 'monthly',
  quantity: '1',
  unit_price_paise: '45000',
  shipping_paise: '0',
  current_cycle: 2,
  total_count: 120,
  min_cycles: null,
  ...o,
})

describe('loadCustomerSubscriptions term fields', () => {
  it('exposes currentCycle, a fixed totalCycles and minCycles', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([row({ total_count: 12, min_cycles: 3 }), row({ id: 's2' })] as any)
      .mockResolvedValueOnce([])
    const [fixed, open] = await loadCustomerSubscriptions('u1')
    expect(fixed).toMatchObject({ currentCycle: 2, totalCycles: 12, minCycles: 3 })
    expect(open).toMatchObject({ totalCycles: null, minCycles: null })
  })
})
