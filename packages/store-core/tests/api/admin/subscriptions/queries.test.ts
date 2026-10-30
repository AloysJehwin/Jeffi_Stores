import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/queries/shared', () => ({ queryOne: vi.fn(), queryMany: vi.fn(), queryCount: vi.fn() }))

import { listAdminSubscriptions, getAdminSubscriptionStats } from '@/lib/queries/subscriptions'
import { queryOne, queryMany, queryCount } from '@/lib/queries/shared'

const mockOne = queryOne as ReturnType<typeof vi.fn>
const mockMany = queryMany as ReturnType<typeof vi.fn>
const mockCount = queryCount as ReturnType<typeof vi.fn>

const row = {
  id: 's1',
  status: 'active',
  user_id: 'u1',
  first_name: 'Asha',
  last_name: 'K',
  email: 'a@x.in',
  product_id: 'p1',
  product_name: 'Coffee',
  is_digital: false,
  interval: 'quarterly',
  quantity: '2.000',
  cycle_paise: '59900.000',
  current_cycle: 3,
  current_end: null,
  cancel_at_cycle_end: false,
  collecting_account: 'platform',
  razorpay_subscription_id: 'sub_X',
  created_at: '2026-10-01',
}

describe('admin subscription queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMany.mockResolvedValue([row])
    mockCount.mockResolvedValue(1)
  })

  it('excludes legacy rows and applies no filters by default', async () => {
    const res = await listAdminSubscriptions({})
    const [sql, params] = mockMany.mock.calls[0]
    expect(sql).toMatch(/s\.source <> 'legacy'/)
    expect(params).toEqual([25, 0])
    expect(res.items[0]).toMatchObject({
      customerName: 'Asha K',
      intervalLabel: 'Every 3 months',
      statusLabel: 'Active',
      quantity: 2,
      amount: 599,
    })
  })

  it('filters by a known status, search and page', async () => {
    await listAdminSubscriptions({ status: 'halted', q: ' asha ', page: 2 })
    const [sql, params] = mockMany.mock.calls[0]
    expect(sql).toMatch(/s\.status = \$1/)
    expect(sql).toMatch(/u\.email ILIKE \$2/)
    expect(params).toEqual(['halted', '%asha%', 25, 25])
    expect(mockCount.mock.calls[0][1]).toEqual(['halted', '%asha%'])
  })

  it('ignores an unknown status', async () => {
    await listAdminSubscriptions({ status: 'bogus' })
    expect(mockMany.mock.calls[0][1]).toEqual([25, 0])
  })

  it('normalises MRR to monthly and returns rupees', async () => {
    mockOne.mockResolvedValue({ active: 4, paused: 1, halted: 2, cancelled: 3, mrr_paise: '123456.7' })
    const stats = await getAdminSubscriptionStats()
    expect(stats).toEqual({ active: 4, paused: 1, halted: 2, cancelled: 3, mrr: 1234.57 })
    const sql = mockOne.mock.calls[0][0]
    expect(sql).toMatch(/WHEN 'weekly' THEN 52\.0 \/ 12/)
    expect(sql).toMatch(/WHEN 'quarterly' THEN 1\.0 \/ 3/)
    expect(sql).toMatch(/WHEN 'yearly' THEN 1\.0 \/ 12/)
  })
})
