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

// ---------------------------------------------------------------------------
// Scoring band coverage — recency, frequency, monetary, engagement, satisfaction
// ---------------------------------------------------------------------------

describe('computeHealthForUser – scoring bands', () => {
  beforeEach(() => vi.clearAllMocks())

  // recency bands
  it('scores recency=50 for 90–179 days', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '120' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBe(50)
  })

  it('scores recency=20 for 180–364 days', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '200' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.recency_score).toBe(20)
  })

  // frequency bands
  it('scores frequency=100 for ordersPerYear >= 12', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '24', account_age_days: '365' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.frequency_score).toBe(100)
  })

  it('scores frequency=80 for ordersPerYear 6–11', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '6', account_age_days: '365' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.frequency_score).toBe(80)
  })

  it('scores frequency=60 for ordersPerYear 3–5', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '3', account_age_days: '365' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.frequency_score).toBe(60)
  })

  it('scores frequency=30 for ordersPerYear 1–2', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '1', account_age_days: '365' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.frequency_score).toBe(30)
  })

  it('scores frequency=0 for ordersPerYear < 1', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '0', account_age_days: '365' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.frequency_score).toBe(0)
  })

  // monetary bands
  it('scores monetary=80 for ltv 50000–99999', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ ltv: '75000' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.monetary_score).toBe(80)
  })

  it('scores monetary=60 for ltv 20000–49999', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ ltv: '30000' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.monetary_score).toBe(60)
  })

  it('scores monetary=40 for ltv 5000–19999', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ ltv: '10000' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.monetary_score).toBe(40)
  })

  it('scores monetary=20 for ltv 1–4999', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ ltv: '2500' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.monetary_score).toBe(20)
  })

  // engagement bands
  it('scores engagement=100 for blended >= 0.5', async () => {
    // 10 sends, 6 opens (openRate=0.6), 6 clicks (clickRate=0.6)
    // blended = 0.6*0.4 + 0.6*0.6 = 0.6 >= 0.5
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ email_sends_90d: '10', email_opens_90d: '6', email_clicks_90d: '6' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.engagement_score).toBe(100)
  })

  it('scores engagement=70 for blended 0.25–0.49', async () => {
    // 10 sends, 3 opens (0.3), 2 clicks (0.2)
    // blended = 0.3*0.4 + 0.2*0.6 = 0.12 + 0.12 = 0.24 — too low, adjust:
    // 10 sends, 4 opens (0.4), 2 clicks (0.2) → 0.4*0.4 + 0.2*0.6 = 0.16+0.12=0.28
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ email_sends_90d: '10', email_opens_90d: '4', email_clicks_90d: '2' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.engagement_score).toBe(70)
  })

  it('scores engagement=40 for blended 0.1–0.24', async () => {
    // 10 sends, 2 opens (0.2), 1 click (0.1) → 0.2*0.4+0.1*0.6 = 0.08+0.06=0.14
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ email_sends_90d: '10', email_opens_90d: '2', email_clicks_90d: '1' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.engagement_score).toBe(40)
  })

  it('scores engagement=20 for blended < 0.1', async () => {
    // 10 sends, 0 opens, 0 clicks → blended=0 < 0.1
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ email_sends_90d: '10', email_opens_90d: '0', email_clicks_90d: '0' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.engagement_score).toBe(20)
  })

  // satisfaction branches
  it('scores satisfaction=70 when paidOrders=0', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '0', return_count: '0', low_review_count: '0', avg_rating: null }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.satisfaction_score).toBe(70)
  })

  it('satisfaction adjusts upward for avg_rating > 3', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '10', return_count: '0', low_review_count: '0', avg_rating: '5' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    // score = 100 + (5-3)*10 = 120 → clamped to 100
    expect(result!.satisfaction_score).toBe(100)
  })

  it('satisfaction adjusts downward for avg_rating < 3', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '10', return_count: '0', low_review_count: '0', avg_rating: '1' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    // score = 100 + (1-3)*10 = 80
    expect(result!.satisfaction_score).toBe(80)
  })

  it('satisfaction clamps to 0 with high returns and low reviews', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ paid_orders: '2', return_count: '2', low_review_count: '5', avg_rating: '1' }))
      .mockResolvedValueOnce(null)
    const result = await computeHealthForUser('user-1')
    expect(result!.satisfaction_score).toBe(0)
  })

  // churn_risk: rising_concern via score < 50 and trendDelta < -5
  it('churn_risk is rising_concern when score < 50 and trendDelta30d < -5', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: '50', ltv: '0', paid_orders: '0', email_sends_90d: '0', email_opens_90d: '0', email_clicks_90d: '0' }))
      .mockResolvedValueOnce({ score: 55, trend_delta_30d: -10 }) // trendDelta = -10 < -5

    const result = await computeHealthForUser('user-1')
    expect(result!.churn_risk).toBe('rising_concern')
  })

  // churn_risk: high when score < 40 and days_since_last_order is null
  it('churn_risk is high when score < 40 and days_since_last_order is null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow({ days_since_last_order: null, ltv: '0', paid_orders: '0', email_sends_90d: '10', email_opens_90d: '0', email_clicks_90d: '0' }))
      .mockResolvedValueOnce(null)

    const result = await computeHealthForUser('user-1')
    expect(result!.churn_risk).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// recomputeHealth – trend calculation branches (snap7/snap30 present)
// ---------------------------------------------------------------------------

describe('recomputeHealth – trend branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('uses snap7 for trend7 when it exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow()) // loadSignals
      .mockResolvedValueOnce({ score: 70, trend_delta_30d: 0 }) // previous health (computeHealthForUser)
      .mockResolvedValueOnce({ score: 65 }) // oldHealth
      .mockResolvedValueOnce({ score: 60 }) // snap7
      .mockResolvedValueOnce(null)          // snap30
      .mockResolvedValueOnce(null)          // lastSnap
      .mockResolvedValueOnce({ user_id: 'user-1', score: 72, recency_score: 80, frequency_score: 60, monetary_score: 80, engagement_score: 50, satisfaction_score: 100, churn_risk: 'healthy', trend_delta_7d: 12, trend_delta_30d: 0, last_computed_at: '2024-01-01' })

    const result = await recomputeHealth('user-1')
    expect(result).not.toBeNull()
    const insertCall = mockQuery.mock.calls[0]
    // trend7 = computed.score - snap7.score (passed as arg $9)
    expect(insertCall[1][8]).toBeDefined() // trend7 param exists
  })

  it('uses snap30 for trend30 when it exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow()) // loadSignals
      .mockResolvedValueOnce({ score: 70, trend_delta_30d: 0 }) // previous health
      .mockResolvedValueOnce({ score: 65 }) // oldHealth
      .mockResolvedValueOnce(null)          // snap7
      .mockResolvedValueOnce({ score: 55 }) // snap30
      .mockResolvedValueOnce(null)          // lastSnap
      .mockResolvedValueOnce({ user_id: 'user-1', score: 72, recency_score: 80, frequency_score: 60, monetary_score: 80, engagement_score: 50, satisfaction_score: 100, churn_risk: 'healthy', trend_delta_7d: 0, trend_delta_30d: 17, last_computed_at: '2024-01-01' })

    const result = await recomputeHealth('user-1')
    expect(result).not.toBeNull()
  })

  it('skips snapshot insert when lastSnap is recent (< 7 days)', async () => {
    const recentSnap = new Date(Date.now() - 1 * 86400000).toISOString() // 1 day ago
    mockQueryOne
      .mockResolvedValueOnce(makeSignalRow())
      .mockResolvedValueOnce({ score: 70, trend_delta_30d: 0 })
      .mockResolvedValueOnce({ score: 65 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ snapshot_at: recentSnap }) // recent snap → skip insert
      .mockResolvedValueOnce({ user_id: 'user-1', score: 72, recency_score: 80, frequency_score: 60, monetary_score: 80, engagement_score: 50, satisfaction_score: 100, churn_risk: 'healthy', trend_delta_7d: 0, trend_delta_30d: 0, last_computed_at: '2024-01-01' })

    await recomputeHealth('user-1')
    const queryCalls = mockQuery.mock.calls.map(c => c[0] as string)
    // Should NOT insert into customer_health_history
    expect(queryCalls.filter(s => s.includes('customer_health_history')).length).toBe(0)
  })
})
