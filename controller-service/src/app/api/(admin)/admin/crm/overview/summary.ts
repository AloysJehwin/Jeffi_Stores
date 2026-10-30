import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, istToday, previousPeriod, type Bucket, type Period } from '@controller/app/(admin)/admin/crm/_lib/period'
import {
  buildAttention,
  buildCohorts,
  num,
  toKpis,
  toTopCustomers,
  toTrend,
  type CrmOverviewData,
} from '@controller/app/(admin)/admin/crm/_lib/overview'

// Registered customers only; an order counts once it is paid (or COD collected) and not cancelled or returned.
const REALIZED = `o.payment_status IN ('paid', 'cod_collected') AND o.status NOT IN ('cancelled', 'returned')`

const BOUNDS = `b AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS s,
         (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS e
)`

export const KPI_SQL = `
WITH ${BOUNDS},
cust AS (SELECT id, created_at FROM users WHERE is_guest = false),
ro AS (
  SELECT o.user_id, o.created_at, o.total_amount
    FROM orders o JOIN cust c ON c.id = o.user_id CROSS JOIN b
   WHERE ${REALIZED} AND o.created_at < b.e
),
life AS (SELECT user_id, COUNT(*) AS n, SUM(total_amount) AS ltv, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM ro GROUP BY user_id),
inp AS (SELECT ro.user_id, COUNT(*) AS n, SUM(ro.total_amount) AS rev FROM ro CROSS JOIN b WHERE ro.created_at >= b.s GROUP BY ro.user_id)
SELECT
  (SELECT COUNT(*) FROM cust CROSS JOIN b WHERE cust.created_at < b.e) AS total_customers,
  (SELECT COUNT(*) FROM cust CROSS JOIN b WHERE cust.created_at >= b.s AND cust.created_at < b.e) AS new_customers,
  (SELECT COUNT(*) FROM inp) AS active_customers,
  (SELECT COUNT(*) FROM inp JOIN life l USING (user_id) CROSS JOIN b WHERE l.first_at >= b.s) AS first_time_buyers,
  (SELECT COUNT(*) FROM inp JOIN life l USING (user_id) WHERE l.n >= 2) AS repeat_customers,
  (SELECT COALESCE(SUM(n), 0) FROM inp) AS orders,
  (SELECT COALESCE(SUM(rev), 0) FROM inp) AS revenue,
  (SELECT COUNT(*) FROM life) AS buyers_to_date,
  (SELECT COALESCE(SUM(ltv), 0) FROM life) AS lifetime_revenue,
  (SELECT COUNT(*) FROM life CROSS JOIN b WHERE last_at < b.e - INTERVAL '90 days' AND last_at >= b.e - INTERVAL '180 days') AS at_risk,
  (SELECT COUNT(*) FROM life CROSS JOIN b WHERE last_at < b.e - INTERVAL '180 days') AS churned
`

const SERIES_START: Record<Bucket, string> = {
  day: '$1::date::timestamp',
  week: "date_trunc('week', $1::date::timestamp)",
  month: "date_trunc('month', $1::date::timestamp)",
}

export const trendSql = (bucket: Bucket) => `
WITH ${BOUNDS},
ro AS (
  SELECT o.user_id, o.created_at, o.total_amount,
         ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.created_at, o.id) AS rn
    FROM orders o JOIN users u ON u.id = o.user_id AND u.is_guest = false
   WHERE ${REALIZED}
),
buckets AS (SELECT generate_series(${SERIES_START[bucket]}, $2::date::timestamp, INTERVAL '1 ${bucket}') AS bucket)
SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
       COALESCE(SUM(ro.total_amount) FILTER (WHERE ro.rn = 1), 0) AS new_revenue,
       COALESCE(SUM(ro.total_amount) FILTER (WHERE ro.rn > 1), 0) AS returning_revenue,
       COUNT(DISTINCT ro.user_id) FILTER (WHERE ro.rn = 1) AS new_buyers,
       COUNT(DISTINCT ro.user_id) FILTER (WHERE ro.rn > 1) AS returning_buyers
  FROM buckets k CROSS JOIN b
  LEFT JOIN ro ON ro.created_at >= b.s AND ro.created_at < b.e
              AND date_trunc('${bucket}', ro.created_at AT TIME ZONE 'Asia/Kolkata') = k.bucket
 GROUP BY k.bucket
 ORDER BY k.bucket
`

export const COHORT_SQL = `
WITH ro AS (
  SELECT o.user_id, date_trunc('month', o.created_at AT TIME ZONE 'Asia/Kolkata') AS m
    FROM orders o JOIN users u ON u.id = o.user_id AND u.is_guest = false
   WHERE ${REALIZED}
),
firsts AS (SELECT user_id, MIN(m) AS cohort FROM ro GROUP BY user_id),
recent AS (SELECT * FROM firsts WHERE cohort >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '11 months'),
act AS (
  SELECT f.cohort,
         ((EXTRACT(YEAR FROM r.m) - EXTRACT(YEAR FROM f.cohort)) * 12 + EXTRACT(MONTH FROM r.m) - EXTRACT(MONTH FROM f.cohort))::int AS k,
         COUNT(DISTINCT r.user_id) AS active
    FROM ro r JOIN recent f ON f.user_id = r.user_id
   GROUP BY 1, 2
)
SELECT to_char(s.cohort, 'YYYY-MM') AS cohort, s.size, a.k, a.active
  FROM (SELECT cohort, COUNT(*) AS size FROM recent GROUP BY cohort) s
  LEFT JOIN act a ON a.cohort = s.cohort AND a.k BETWEEN 1 AND 6
 ORDER BY s.cohort, a.k
`

export const TOP_CUSTOMERS_SQL = `
WITH ${BOUNDS},
ro AS (
  SELECT o.user_id, o.created_at, o.total_amount
    FROM orders o JOIN users u ON u.id = o.user_id AND u.is_guest = false CROSS JOIN b
   WHERE ${REALIZED} AND o.created_at < b.e
),
inp AS (SELECT ro.user_id, COUNT(*) AS orders, SUM(ro.total_amount) AS revenue FROM ro CROSS JOIN b WHERE ro.created_at >= b.s GROUP BY ro.user_id),
life AS (SELECT user_id, COUNT(*) AS orders, SUM(total_amount) AS ltv, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM ro GROUP BY user_id)
SELECT u.id, u.first_name, u.last_name, u.email, i.orders, i.revenue, l.orders AS lifetime_orders, l.ltv,
       l.first_at, l.last_at, ch.score AS health_score, ch.churn_risk
  FROM inp i JOIN life l USING (user_id) JOIN users u ON u.id = i.user_id
  LEFT JOIN customer_health ch ON ch.user_id = i.user_id
 ORDER BY i.revenue DESC
 LIMIT 10
`

export const ATTENTION_SQL = `
WITH ro AS (
  SELECT o.user_id, o.created_at, o.total_amount
    FROM orders o JOIN users u ON u.id = o.user_id AND u.is_guest = false
   WHERE ${REALIZED}
),
life AS (SELECT user_id, COUNT(*) AS n, SUM(total_amount) AS ltv, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM ro GROUP BY user_id),
quiet AS (SELECT ltv FROM life WHERE ltv >= 25000 AND last_at < NOW() - INTERVAL '90 days' AND last_at >= NOW() - INTERVAL '180 days')
SELECT
  (SELECT COUNT(*) FROM quiet) AS high_value_quiet,
  (SELECT COALESCE(SUM(ltv), 0) FROM quiet) AS high_value_quiet_ltv,
  (SELECT COUNT(*) FROM life WHERE n = 1 AND first_at < NOW() - INTERVAL '30 days' AND first_at >= NOW() - INTERVAL '90 days') AS no_second_order,
  (SELECT COUNT(*) FROM customer_health ch JOIN users u ON u.id = ch.user_id AND u.is_guest = false
    WHERE ch.score < 40
      AND NOT EXISTS (SELECT 1 FROM customer_tasks ct WHERE ct.user_id = ch.user_id AND ct.status IN ('pending', 'in_progress'))) AS critical_no_task,
  (SELECT COUNT(*) FROM users u WHERE u.is_guest = false AND u.created_at >= NOW() - INTERVAL '14 days'
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)) AS new_leads
`

export async function getCrmOverview(period: Period, now = new Date()): Promise<CrmOverviewData> {
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const [cur, prev, trend, cohorts, top, att] = await Promise.all([
    queryOne(KPI_SQL, [period.from, period.to]),
    queryOne(KPI_SQL, [previous.from, previous.to]),
    queryMany(trendSql(bucket), [period.from, period.to]),
    queryMany(COHORT_SQL),
    queryMany(TOP_CUSTOMERS_SQL, [period.from, period.to]),
    queryOne(ATTENTION_SQL),
  ])
  const current = toKpis(cur)
  const prior = toKpis(prev)
  return {
    period,
    previous,
    bucket,
    current,
    prior,
    trend: toTrend(trend),
    cohorts: buildCohorts(cohorts, istToday(now).slice(0, 7)),
    topCustomers: toTopCustomers(top),
    attention: buildAttention(
      {
        highValueQuiet: num(att?.high_value_quiet),
        highValueQuietLtv: num(att?.high_value_quiet_ltv),
        noSecondOrder: num(att?.no_second_order),
        criticalNoTask: num(att?.critical_no_task),
        newLeads: num(att?.new_leads),
      },
      current,
      prior
    ),
  }
}
