import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

import { computeHealthForUser, recomputeHealth, getHealth, getOrComputeHealth, HEALTH_WEIGHTS } from '@/lib/customer-health'
import * as db from '@/lib/db'

const mockQuery = db.query as ReturnType<typeof vi.fn>
const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>

// A helper to build a full signals row
function makeSignalRow(overrides: Record<string, string | null> = {}) {
  return {
    days_since_last_order: '30',
    paid_orders: '12',
    account_age_days: '365',
    ltv: '60000',
    email_sends_90d: '10',
    email_opens_90d: '4',
    email_clicks_90d: '2',
    return_count: '0',
    low_review_count: '0',
    avg_rating: '4.5',
    ...overrides,
  }
}

describe('HEALTH_WEIGHTS', () => {
  it('weights sum to 100', () => {
    const total = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })
})

describe('computeHealthForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when loadSignals returns null', async () => {
    mockQueryOne.mockResolvedValueOnce(null) // loadSignals row null
    const result = await computeHealthForUser('user-1')
    expect(result).toBeNull()
  })

  it('returns a score between 0 and 100', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow()) // signals
      .mockResolvedValueOnce(null) // previous health

    const result = await computeHealthForUser('user-1')
    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThanOrEqual(0)
    expect(result!.score).toBeLessThanOrEqual(100)
  })

  it('exposes individual component scores', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow())
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBeDefined()
    expect(result!.frequency_score).toBeDefined()
    expect(result!.monetary_score).toBeDefined()
    expect(result!.engagement_score).toBeDefined()
    expect(result!.satisfaction_score).toBeDefined()
  })

  it('scores recency=100 for recent order (< 30 days)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '10' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBe(100)
  })

  it('scores recency=80 for 30–89 days', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '60' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBe(80)
  })

  it('scores recency=0 for days >= 365', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '400' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBe(0)
  })

  it('scores recency=0 when days_since_last_order is null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: null }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBe(0)
  })

  it('scores monetary=100 for ltv >= 100000', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ ltv: '150000' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.monetary_score).toBe(100)
  })

  it('scores monetary=0 for ltv=0', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ ltv: '0' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.monetary_score).toBe(0)
  })

  it('scores engagement=50 when sends=0', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ email_sends_90d: '0', email_opens_90d: '0', email_clicks_90d: '0' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.engagement_score).toBe(50)
  })

  it('uses previous trend_delta_30d in churn_risk calculation', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '100', ltv: '1000' }))
      .mockResolvedValueOnce({ score: 55, trend_delta_30d: -20 }) // big negative trend

    const result = await computeHealthForUser('user-1')
    expect(result!.churn_risk).toBe('rising_concern')
  })

  it('churn_risk is healthy for high score', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '10', ltv: '60000', paid_orders: '24' }))
      .mockResolvedValueOnce({ score: 90, trend_delta_30d: 0 })

    const result = await computeHealthForUser('user-1')
    expect(result!.churn_risk).toBe('healthy')
  })

  it('churn_risk is high when score < 40 and days > 90', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '200', ltv: '0', paid_orders: '0' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.churn_risk).toBe('high')
  })
})

describe('getHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no row found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getHealth('user-1')
    expect(result).toBeNull()
  })

  it('returns the health row', async () => {
    const row = {
      user_id: 'user-1', score: 72, recency_score: 80, frequency_score: 60,
      monetary_score: 80, engagement_score: 50, satisfaction_score: 100,
      churn_risk: 'healthy', trend_delta_7d: 2, trend_delta_30d: 5,
      last_computed_at: '2024-01-01T00:00:00Z',
    }
    mockQueryOne.mockResolvedValueOnce(row)
    const result = await getHealth('user-1')
    expect(result).toEqual(row)
  })
})

describe('recomputeHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns null when computeHealthForUser returns null', async () => {
    mockQueryOne.mockResolvedValueOnce(null) // loadSignals returns null
    const result = await recomputeHealth('user-1')
    expect(result).toBeNull()
  })

  it('inserts into customer_health and calls getHealth', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow()) // loadSignals
      .mockResolvedValueOnce({ score: 70, trend_delta_30d: 0 }) // previous health (computeHealthForUser)
      .mockResolvedValueOnce({ score: 65 }) // oldHealth
      .mockResolvedValueOnce(null) // snap7
      .mockResolvedValueOnce(null) // snap30
      .mockResolvedValueOnce(null) // lastSnap
      .mockResolvedValueOnce({ // getHealth final call
        user_id: 'user-1', score: 72, recency_score: 80, frequency_score: 60,
        monetary_score: 80, engagement_score: 50, satisfaction_score: 100,
        churn_risk: 'healthy', trend_delta_7d: 2, trend_delta_30d: 0,
        last_computed_at: '2024-01-01T00:00:00Z',
      })

    const result = await recomputeHealth('user-1')
    expect(mockQuery).toHaveBeenCalled()
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain('INSERT INTO customer_health')
    expect(result).not.toBeNull()
    expect(result!.score).toBe(72)
  })

  it('inserts snapshot when no recent snapshot exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow())
      .mockResolvedValueOnce(null) // previous health
      .mockResolvedValueOnce(null) // oldHealth
      .mockResolvedValueOnce(null) // snap7
      .mockResolvedValueOnce(null) // snap30
      .mockResolvedValueOnce(null) // lastSnap — no snapshot → should snapshot
      .mockResolvedValueOnce({ user_id: 'user-1', score: 60, recency_score: 50, frequency_score: 40, monetary_score: 20, engagement_score: 50, satisfaction_score: 70, churn_risk: 'healthy', trend_delta_7d: 0, trend_delta_30d: 0, last_computed_at: '2024-01-01' })

    await recomputeHealth('user-1')
    // At least one query call should be the health_history insert
    const queryCalls = mockQuery.mock.calls.map(c => c[0] as string)
    expect(queryCalls.some(s => s.includes('customer_health_history'))).toBe(true)
  })
})

describe('getOrComputeHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns cached health when fresh enough', async () => {
    const recentDate = new Date(Date.now() - 1 * 3600 * 1000).toISOString() // 1 hour ago
    const row = {
      user_id: 'user-1', score: 75, recency_score: 80, frequency_score: 60,
      monetary_score: 80, engagement_score: 50, satisfaction_score: 100,
      churn_risk: 'healthy', trend_delta_7d: 0, trend_delta_30d: 0,
      last_computed_at: recentDate,
    }
    mockQueryOne.mockResolvedValueOnce(row)
    const result = await getOrComputeHealth('user-1', 24)
    expect(result).toEqual(row)
    // Should NOT call recomputeHealth (which calls query)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('recomputes when cached health is stale', async () => {
    const staleDate = new Date(Date.now() - 30 * 3600 * 1000).toISOString() // 30 hours ago
    const row = {
      user_id: 'user-1', score: 75, recency_score: 80, frequency_score: 60,
      monetary_score: 80, engagement_score: 50, satisfaction_score: 100,
      churn_risk: 'healthy', trend_delta_7d: 0, trend_delta_30d: 0,
      last_computed_at: staleDate,
    }
    // First getHealth call returns stale row
    mockQueryOne
      .mockResolvedValueOnce(row) // getHealth → stale
      .mockResolvedValueOnce(null) // loadSignals (computeHealthForUser) → null → recompute returns null

    const result = await getOrComputeHealth('user-1', 24)
    // recomputeHealth was called (loadSignals returned null, so null)
    expect(result).toBeNull()
  })

  it('recomputes when no cached health exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // getHealth → null
      .mockResolvedValueOnce(null) // loadSignals → null

    const result = await getOrComputeHealth('user-1')
    expect(result).toBeNull()
  })
})
