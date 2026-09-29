import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { vi as _vi } from 'vitest'

// We test the pure transformation logic directly — DB is mocked
import { getCrmDashboardData } from '@/lib/admin-crm'
import * as db from '@/lib/db'

const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>

function makeSegmentCounts(overrides = {}) {
  return {
    total: '100', vip: '5', loyal: '10', repeat: '30',
    one_time: '20', new: '8', at_risk: '7', dormant: '4',
    b2b: '3', lead: '12',
    ...overrides,
  }
}

describe('getCrmDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed segment counts', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts()) // segmentCounts
      .mockResolvedValueOnce({ count: '3' })       // leadCount
      .mockResolvedValueOnce({ open_count: '5', overdue_count: '1', mine_count: '2' }) // taskCounts
      .mockResolvedValueOnce({ b0_20: '2', b20_40: '3', b40_60: '5', b60_80: '8', b80_100: '4', unscored: '10' }) // healthDistribution

    mockQueryMany
      .mockResolvedValue([]) // all queryMany calls return empty

    const data = await getCrmDashboardData('admin-uuid')

    expect(data.segments.total).toBe(100)
    expect(data.segments.vip).toBe(5)
    expect(data.segments.loyal).toBe(10)
    expect(data.segments.at_risk).toBe(7)
    expect(data.segments.b2b).toBe(3)
  })

  it('handles null segmentCounts gracefully (all zeroes)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // segmentCounts null
      .mockResolvedValueOnce(null) // leadCount null
      .mockResolvedValueOnce(null) // taskCounts null
      .mockResolvedValueOnce(null) // healthDistribution null

    mockQueryMany.mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')

    expect(data.segments.total).toBe(0)
    expect(data.segments.vip).toBe(0)
    expect(data.leadsThisWeek).toBe(0)
    expect(data.tasks.open).toBe(0)
  })

  it('maps crossingAtRisk rows using fmtName', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    mockQueryMany
      .mockResolvedValueOnce([{ id: 'u1', first_name: 'Alice', last_name: 'Smith', email: 'a@x.com', last_order_at: '2024-01-01', ltv: '15000' }]) // crossingAtRisk
      .mockResolvedValue([]) // all others

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.crossingAtRisk).toHaveLength(1)
    expect(data.crossingAtRisk[0].name).toBe('Alice Smith')
    expect(data.crossingAtRisk[0].ltv).toBe(15000)
  })

  it('falls back to email when first/last name both null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    mockQueryMany
      .mockResolvedValueOnce([{ id: 'u2', first_name: null, last_name: null, email: 'noreply@x.com', last_order_at: '2024-01-01', ltv: '500' }])
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.crossingAtRisk[0].name).toBe('noreply@x.com')
  })

  it('maps recentNotes with admin name fallback', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const noteRow = {
      user_id: 'u1', body: 'Called customer', created_at: '2024-06-01',
      first_name: 'Joe', last_name: 'Doe', email: 'j@x.com',
      admin_first_name: null, admin_last_name: null,
    }

    mockQueryMany
      .mockResolvedValueOnce([]) // crossingAtRisk
      .mockResolvedValueOnce([]) // crossingDormant
      .mockResolvedValueOnce([]) // recentTags
      .mockResolvedValueOnce([noteRow]) // recentNotes
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.recentNotes).toHaveLength(1)
    expect(data.recentNotes[0].adminName).toBe('Admin')
    expect(data.recentNotes[0].body).toBe('Called customer')
  })

  it('maps health distribution correctly', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '2' })
      .mockResolvedValueOnce({ open_count: '3', overdue_count: '1', mine_count: '1' })
      .mockResolvedValueOnce({ b0_20: '10', b20_40: '20', b40_60: '30', b60_80: '25', b80_100: '15', unscored: '5' })

    mockQueryMany.mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.health.distribution.b0_20).toBe(10)
    expect(data.health.distribution.b80_100).toBe(15)
    expect(data.health.distribution.unscored).toBe(5)
  })

  it('maps topChurnRisks with daysSinceLastOrder', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const churnRow = { id: 'u3', first_name: 'Tim', last_name: null, email: 't@x.com', score: 22, ltv: '8000', days_since_last_order: '120' }

    mockQueryMany
      .mockResolvedValueOnce([]) // crossingAtRisk
      .mockResolvedValueOnce([]) // crossingDormant
      .mockResolvedValueOnce([]) // recentTags
      .mockResolvedValueOnce([]) // recentNotes
      .mockResolvedValueOnce([]) // topTags
      .mockResolvedValueOnce([]) // recentSignups
      .mockResolvedValueOnce([churnRow]) // topChurnRisks
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.health.topChurnRisks).toHaveLength(1)
    expect(data.health.topChurnRisks[0].daysSinceLastOrder).toBe(120)
    expect(data.health.topChurnRisks[0].ltv).toBe(8000)
  })

  it('maps crossingDormant rows', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const dormantRow = { id: 'u10', first_name: 'Dormant', last_name: 'User', email: 'd@x.com', last_order_at: '2023-01-01', ltv: '2500' }

    mockQueryMany
      .mockResolvedValueOnce([])          // crossingAtRisk
      .mockResolvedValueOnce([dormantRow]) // crossingDormant
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.crossingDormant).toHaveLength(1)
    expect(data.crossingDormant[0].name).toBe('Dormant User')
    expect(data.crossingDormant[0].ltv).toBe(2500)
    expect(data.crossingDormant[0].lastOrderAt).toBe('2023-01-01')
  })

  it('maps topTags and recentSignups', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '5' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const tagRow = { tag: 'wholesale', count: '12' }
    const signupRow = { id: 's1', first_name: 'New', last_name: 'User', email: 'new@x.com', created_at: '2024-06-01' }

    mockQueryMany
      .mockResolvedValueOnce([]) // crossingAtRisk
      .mockResolvedValueOnce([]) // crossingDormant
      .mockResolvedValueOnce([]) // recentTags
      .mockResolvedValueOnce([]) // recentNotes
      .mockResolvedValueOnce([tagRow])    // topTags
      .mockResolvedValueOnce([signupRow]) // recentSignups
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.topTags).toHaveLength(1)
    expect(data.topTags[0].tag).toBe('wholesale')
    expect(data.topTags[0].count).toBe(12)
    expect(data.leadsThisWeek).toBe(5)
    expect(data.recentSignups).toHaveLength(1)
    expect(data.recentSignups[0].name).toBe('New User')
    expect(data.recentSignups[0].email).toBe('new@x.com')
  })

  it('maps recentTags rows', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const tagEventRow = { user_id: 'u5', tag: 'vip', created_at: '2024-06-01', first_name: 'Tag', last_name: 'User', email: 'tag@x.com' }

    mockQueryMany
      .mockResolvedValueOnce([])           // crossingAtRisk
      .mockResolvedValueOnce([])           // crossingDormant
      .mockResolvedValueOnce([tagEventRow]) // recentTags
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.recentTags).toHaveLength(1)
    expect(data.recentTags[0].userId).toBe('u5')
    expect(data.recentTags[0].name).toBe('Tag User')
    expect(data.recentTags[0].tag).toBe('vip')
    expect(data.recentTags[0].createdAt).toBe('2024-06-01')
  })

  it('maps biggestDrops in health', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const dropRow = { id: 'u20', first_name: 'Drop', last_name: 'Risks', email: 'dr@x.com', score: 30, trend_delta_7d: -25 }

    mockQueryMany
      .mockResolvedValueOnce([]) // crossingAtRisk
      .mockResolvedValueOnce([]) // crossingDormant
      .mockResolvedValueOnce([]) // recentTags
      .mockResolvedValueOnce([]) // recentNotes
      .mockResolvedValueOnce([]) // topTags
      .mockResolvedValueOnce([]) // recentSignups
      .mockResolvedValueOnce([]) // topChurnRisks
      .mockResolvedValueOnce([dropRow]) // biggestDrops

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.health.biggestDrops).toHaveLength(1)
    expect(data.health.biggestDrops[0].name).toBe('Drop Risks')
    expect(data.health.biggestDrops[0].delta).toBe(-25)
    expect(data.health.biggestDrops[0].score).toBe(30)
  })

  it('maps topChurnRisks with null daysSinceLastOrder', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSegmentCounts())
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({ open_count: '0', overdue_count: '0', mine_count: '0' })
      .mockResolvedValueOnce({ b0_20: '0', b20_40: '0', b40_60: '0', b60_80: '0', b80_100: '0', unscored: '0' })

    const churnNullDays = { id: 'u4', first_name: null, last_name: null, email: 'x@x.com', score: 15, ltv: '500', days_since_last_order: null }

    mockQueryMany
      .mockResolvedValueOnce([]) // crossingAtRisk
      .mockResolvedValueOnce([]) // crossingDormant
      .mockResolvedValueOnce([]) // recentTags
      .mockResolvedValueOnce([]) // recentNotes
      .mockResolvedValueOnce([]) // topTags
      .mockResolvedValueOnce([]) // recentSignups
      .mockResolvedValueOnce([churnNullDays]) // topChurnRisks
      .mockResolvedValue([])

    const data = await getCrmDashboardData('admin-uuid')
    expect(data.health.topChurnRisks[0].daysSinceLastOrder).toBeNull()
  })
})
