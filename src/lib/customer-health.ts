import { query, queryOne } from './db'

export const HEALTH_WEIGHTS = {
  recency: 40,
  frequency: 30,
  monetary: 20,
  engagement: 5,
  satisfaction: 5,
} as const

export type ChurnRisk = 'healthy' | 'rising_concern' | 'high'

export interface HealthBreakdown {
  user_id: string
  score: number
  recency_score: number
  frequency_score: number
  monetary_score: number
  engagement_score: number
  satisfaction_score: number
  churn_risk: ChurnRisk
  trend_delta_7d: number
  trend_delta_30d: number
  last_computed_at: string
}

function recencyScore(daysSinceLastOrder: number | null): number {
  if (daysSinceLastOrder == null) return 0
  if (daysSinceLastOrder < 30) return 100
  if (daysSinceLastOrder < 90) return 80
  if (daysSinceLastOrder < 180) return 50
  if (daysSinceLastOrder < 365) return 20
  return 0
}

function frequencyScore(ordersPerYear: number): number {
  if (ordersPerYear >= 12) return 100
  if (ordersPerYear >= 6) return 80
  if (ordersPerYear >= 3) return 60
  if (ordersPerYear >= 1) return 30
  return 0
}

function monetaryScore(ltv: number): number {
  if (ltv >= 100000) return 100
  if (ltv >= 50000) return 80
  if (ltv >= 20000) return 60
  if (ltv >= 5000) return 40
  if (ltv > 0) return 20
  return 0
}

function engagementScore(opens: number, clicks: number, sends: number): number {
  if (sends === 0) return 50
  const openRate = opens / sends
  const clickRate = clicks / sends
  const blended = openRate * 0.4 + clickRate * 0.6
  if (blended >= 0.5) return 100
  if (blended >= 0.25) return 70
  if (blended >= 0.1) return 40
  return 20
}

function satisfactionScore(returns: number, lowReviews: number, paidOrders: number, avgRating: number | null): number {
  if (paidOrders === 0) return 70
  const returnRate = returns / paidOrders
  let score = 100
  score -= Math.min(50, returnRate * 200)
  score -= Math.min(30, lowReviews * 10)
  if (avgRating != null) {
    score += (avgRating - 3) * 10
  }
  return Math.round(Math.max(0, Math.min(100, score)))
}

function determineChurnRisk(score: number, daysSinceLastOrder: number | null, trendDelta30d: number): ChurnRisk {
  if (score < 40 && (daysSinceLastOrder == null || daysSinceLastOrder > 90)) return 'high'
  if (trendDelta30d <= -15) return 'rising_concern'
  if (score < 50 && trendDelta30d < -5) return 'rising_concern'
  return 'healthy'
}

interface RawSignals {
  days_since_last_order: number | null
  paid_orders: number
  account_age_days: number
  ltv: number
  email_sends_90d: number
  email_opens_90d: number
  email_clicks_90d: number
  return_count: number
  low_review_count: number
  avg_rating: number | null
}

async function loadSignals(userId: string): Promise<RawSignals | null> {
  const row = await queryOne<{
    days_since_last_order: string | null
    paid_orders: string
    account_age_days: string
    ltv: string
    email_sends_90d: string
    email_opens_90d: string
    email_clicks_90d: string
    return_count: string
    low_review_count: string
    avg_rating: string | null
  }>(
    `
    WITH paid AS (
      SELECT created_at, total_amount FROM orders
      WHERE user_id = $1 AND payment_status = 'paid'
    ),
    sends AS (
      SELECT
        COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '90 days')               AS sends,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL AND sent_at > NOW() - INTERVAL '90 days')  AS opens,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL AND sent_at > NOW() - INTERVAL '90 days') AS clicks
      FROM email_campaigns_sent
      WHERE user_id = $1
    ),
    rets AS (
      SELECT COUNT(*) AS cnt FROM return_requests
      WHERE user_id = $1 AND status NOT IN ('rejected')
    ),
    revs AS (
      SELECT
        COUNT(*) FILTER (WHERE rating <= 2) AS low_count,
        AVG(rating)::numeric(3,2)            AS avg_rating
      FROM product_reviews
      WHERE user_id = $1
    )
    SELECT
      EXTRACT(DAY FROM NOW() - (SELECT MAX(created_at) FROM paid))::int::text                                AS days_since_last_order,
      (SELECT COUNT(*) FROM paid)::text                                                                       AS paid_orders,
      EXTRACT(DAY FROM NOW() - (SELECT created_at FROM users WHERE id = $1))::int::text                       AS account_age_days,
      COALESCE((SELECT SUM(total_amount) FROM paid), 0)::text                                                 AS ltv,
      (SELECT sends FROM sends)::text                                                                         AS email_sends_90d,
      (SELECT opens FROM sends)::text                                                                         AS email_opens_90d,
      (SELECT clicks FROM sends)::text                                                                        AS email_clicks_90d,
      (SELECT cnt FROM rets)::text                                                                            AS return_count,
      (SELECT low_count FROM revs)::text                                                                      AS low_review_count,
      (SELECT avg_rating FROM revs)::text                                                                     AS avg_rating
  `,
    [userId]
  )

  if (!row) return null
  return {
    days_since_last_order: row.days_since_last_order != null ? parseInt(row.days_since_last_order, 10) : null,
    paid_orders: parseInt(row.paid_orders || '0', 10),
    account_age_days: parseInt(row.account_age_days || '0', 10),
    ltv: parseFloat(row.ltv || '0'),
    email_sends_90d: parseInt(row.email_sends_90d || '0', 10),
    email_opens_90d: parseInt(row.email_opens_90d || '0', 10),
    email_clicks_90d: parseInt(row.email_clicks_90d || '0', 10),
    return_count: parseInt(row.return_count || '0', 10),
    low_review_count: parseInt(row.low_review_count || '0', 10),
    avg_rating: row.avg_rating != null ? parseFloat(row.avg_rating) : null,
  }
}

export interface ComputedHealth {
  score: number
  recency_score: number
  frequency_score: number
  monetary_score: number
  engagement_score: number
  satisfaction_score: number
  churn_risk: ChurnRisk
  signals: RawSignals
}

export async function computeHealthForUser(userId: string): Promise<ComputedHealth | null> {
  const s = await loadSignals(userId)
  if (!s) return null

  const accountYears = Math.max(s.account_age_days / 365, 1 / 12)
  const ordersPerYear = s.paid_orders / accountYears

  const recency = recencyScore(s.days_since_last_order)
  const frequency = frequencyScore(ordersPerYear)
  const monetary = monetaryScore(s.ltv)
  const engagement = engagementScore(s.email_opens_90d, s.email_clicks_90d, s.email_sends_90d)
  const satisfaction = satisfactionScore(s.return_count, s.low_review_count, s.paid_orders, s.avg_rating)

  const blended =
    (recency * HEALTH_WEIGHTS.recency +
      frequency * HEALTH_WEIGHTS.frequency +
      monetary * HEALTH_WEIGHTS.monetary +
      engagement * HEALTH_WEIGHTS.engagement +
      satisfaction * HEALTH_WEIGHTS.satisfaction) /
    100

  const score = Math.round(Math.max(0, Math.min(100, blended)))

  const previous = await queryOne<{ score: number; trend_delta_30d: number | null }>(
    `SELECT score, trend_delta_30d FROM customer_health WHERE user_id = $1`,
    [userId]
  )

  const churn_risk = determineChurnRisk(score, s.days_since_last_order, previous?.trend_delta_30d ?? 0)

  return {
    score,
    recency_score: recency,
    frequency_score: frequency,
    monetary_score: monetary,
    engagement_score: engagement,
    satisfaction_score: satisfaction,
    churn_risk,
    signals: s,
  }
}

export async function recomputeHealth(userId: string): Promise<HealthBreakdown | null> {
  const computed = await computeHealthForUser(userId)
  if (!computed) return null

  const oldHealth = await queryOne<{ score: number }>(`SELECT score FROM customer_health WHERE user_id = $1`, [userId])

  const snap7 = await queryOne<{ score: number }>(
    `SELECT score FROM customer_health_history
     WHERE user_id = $1 AND snapshot_at <= NOW() - INTERVAL '7 days'
     ORDER BY snapshot_at DESC LIMIT 1`,
    [userId]
  )
  const snap30 = await queryOne<{ score: number }>(
    `SELECT score FROM customer_health_history
     WHERE user_id = $1 AND snapshot_at <= NOW() - INTERVAL '30 days'
     ORDER BY snapshot_at DESC LIMIT 1`,
    [userId]
  )

  const trend7 = snap7 ? computed.score - snap7.score : oldHealth ? computed.score - oldHealth.score : 0
  const trend30 = snap30 ? computed.score - snap30.score : 0

  const finalChurnRisk = determineChurnRisk(computed.score, computed.signals.days_since_last_order, trend30)

  await query(
    `INSERT INTO customer_health
       (user_id, score, recency_score, frequency_score, monetary_score, engagement_score, satisfaction_score,
        churn_risk, trend_delta_7d, trend_delta_30d, last_computed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       score              = EXCLUDED.score,
       recency_score      = EXCLUDED.recency_score,
       frequency_score    = EXCLUDED.frequency_score,
       monetary_score     = EXCLUDED.monetary_score,
       engagement_score   = EXCLUDED.engagement_score,
       satisfaction_score = EXCLUDED.satisfaction_score,
       churn_risk         = EXCLUDED.churn_risk,
       trend_delta_7d     = EXCLUDED.trend_delta_7d,
       trend_delta_30d    = EXCLUDED.trend_delta_30d,
       last_computed_at   = NOW(),
       updated_at         = NOW()`,
    [
      userId,
      computed.score,
      computed.recency_score,
      computed.frequency_score,
      computed.monetary_score,
      computed.engagement_score,
      computed.satisfaction_score,
      finalChurnRisk,
      trend7,
      trend30,
    ]
  )

  const lastSnap = await queryOne<{ snapshot_at: string }>(
    `SELECT snapshot_at FROM customer_health_history
     WHERE user_id = $1 ORDER BY snapshot_at DESC LIMIT 1`,
    [userId]
  )
  const shouldSnapshot = !lastSnap || Date.now() - new Date(lastSnap.snapshot_at).getTime() >= 7 * 86400000
  if (shouldSnapshot) {
    await query(`INSERT INTO customer_health_history (user_id, score, churn_risk) VALUES ($1, $2, $3)`, [
      userId,
      computed.score,
      finalChurnRisk,
    ]).catch(() => {})
  }

  return getHealth(userId)
}

export async function getHealth(userId: string): Promise<HealthBreakdown | null> {
  return queryOne<HealthBreakdown>(
    `SELECT user_id, score, recency_score, frequency_score, monetary_score,
            engagement_score, satisfaction_score, churn_risk,
            trend_delta_7d, trend_delta_30d,
            last_computed_at::text AS last_computed_at
     FROM customer_health WHERE user_id = $1`,
    [userId]
  )
}

export async function getOrComputeHealth(userId: string, maxAgeHours = 24): Promise<HealthBreakdown | null> {
  const cached = await getHealth(userId)
  if (cached) {
    const ageMs = Date.now() - new Date(cached.last_computed_at).getTime()
    if (ageMs < maxAgeHours * 3600 * 1000) return cached
  }
  return recomputeHealth(userId)
}
