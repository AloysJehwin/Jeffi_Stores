import type { AnalyticsRange } from '@/lib/queries'
import {
  CRM_SEGMENT_KEYS,
  CRM_RANGES,
  isCrmSegment,
  isCrmRange,
  type CrmSegment,
  type CrmSegmentKey,
} from '@/lib/shared/crm-insights-shared'

export { CRM_SEGMENT_KEYS, CRM_RANGES, isCrmSegment, isCrmRange }
export type { CrmSegment, CrmSegmentKey }

// Same predicates as the segment counts in admin-crm.ts, evaluated against the agg CTE below.
export const SEGMENT_PREDICATES: Record<CrmSegmentKey, string> = {
  vip: 'ltv >= 50000',
  loyal: 'paid_orders >= 5 AND ltv >= 25000',
  repeat: 'order_count >= 3',
  one_time: 'order_count = 1',
  new: "created_at >= NOW() - INTERVAL '30 days'",
  at_risk:
    "last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '90 days' AND last_order_at >= NOW() - INTERVAL '180 days'",
  dormant: "last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '180 days'",
  b2b: 'is_b2b',
  lead: 'order_count = 0',
}

export const CUSTOMER_AGG_CTE = `agg AS (
  SELECT u.id, u.created_at,
         COALESCE(o.order_count, 0) AS order_count,
         COALESCE(o.paid_orders, 0) AS paid_orders,
         COALESCE(o.lifetime_value, 0) AS ltv,
         o.last_order_at,
         (cp.gst_number IS NOT NULL OR cp.company_name IS NOT NULL) AS is_b2b
    FROM users u
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS order_count,
             COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
             SUM(total_amount) AS lifetime_value,
             MAX(created_at) AS last_order_at
        FROM orders GROUP BY user_id
    ) o ON o.user_id = u.id
   WHERE u.is_guest = false
)`

export interface CrmWindow {
  startExpr: string
  days: number
  label: string
}

export function crmWindow(range: AnalyticsRange): CrmWindow {
  switch (range) {
    case 'today':
      return { startExpr: "date_trunc('day', NOW())", days: 1, label: 'Today' }
    case '7d':
      return { startExpr: "NOW() - INTERVAL '7 days'", days: 7, label: 'Last 7 days' }
    case '90d':
      return { startExpr: "NOW() - INTERVAL '90 days'", days: 90, label: 'Last 90 days' }
    case 'month':
      return { startExpr: "date_trunc('month', NOW())", days: Math.max(1, new Date().getDate()), label: 'This month' }
    case 'year':
      return { startExpr: "NOW() - INTERVAL '1 year'", days: 365, label: 'Last 12 months' }
    default:
      return { startExpr: "NOW() - INTERVAL '30 days'", days: 30, label: 'Last 30 days' }
  }
}

export function segCte(segment: CrmSegment): string {
  if (segment === 'all') return 'seg AS (SELECT id FROM users WHERE is_guest = false)'
  return `${CUSTOMER_AGG_CTE}, seg AS (SELECT id FROM agg WHERE ${SEGMENT_PREDICATES[segment]})`
}

export const scoped = (alias: string, segment: CrmSegment) =>
  segment === 'all' ? '' : ` AND ${alias}.user_id IN (SELECT id FROM seg)`

const PAID_CTE = `paid AS (
  SELECT o.user_id, o.created_at, o.total_amount FROM orders o JOIN seg ON seg.id = o.user_id WHERE o.payment_status = 'paid'
)`

const segmentFilters = (expr: string, suffix: string) =>
  CRM_SEGMENT_KEYS.map(k => `${expr.replace('__PRED__', SEGMENT_PREDICATES[k])} AS ${k}${suffix}`).join(',\n  ')

export const growthSql = (w: CrmWindow, s: CrmSegment) => `
WITH ${segCte(s)}, ${PAID_CTE},
firsts AS (SELECT user_id, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM paid GROUP BY user_id),
inrange AS (SELECT user_id, COUNT(*) AS n FROM paid WHERE created_at >= ${w.startExpr} GROUP BY user_id),
ranked AS (SELECT user_id, created_at, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM paid),
second AS (
  SELECT EXTRACT(EPOCH FROM (r2.created_at - r1.created_at)) / 86400 AS days
    FROM ranked r2 JOIN ranked r1 ON r1.user_id = r2.user_id AND r1.rn = 1
   WHERE r2.rn = 2 AND r2.created_at >= ${w.startExpr}
)
SELECT
  (SELECT COUNT(*) FROM users u JOIN seg ON seg.id = u.id WHERE u.created_at >= ${w.startExpr}) AS new_customers,
  (SELECT COUNT(*) FROM inrange ir JOIN firsts f ON f.user_id = ir.user_id WHERE f.first_at < ${w.startExpr}) AS returning_customers,
  (SELECT COUNT(*) FROM inrange) AS buyers,
  (SELECT COUNT(*) FILTER (WHERE n >= 2) FROM inrange) AS repeat_buyers,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FROM second) AS median_days_to_second,
  (SELECT COUNT(*) FROM firsts WHERE first_at < ${w.startExpr} AND last_at < ${w.startExpr} AND last_at < NOW() - INTERVAL '90 days') AS churned
`

export const cohortSql = (s: CrmSegment) => `
WITH ${segCte(s)}, ${PAID_CTE},
firsts AS (SELECT user_id, date_trunc('month', MIN(created_at)) AS cohort FROM paid GROUP BY user_id),
recent AS (SELECT * FROM firsts WHERE cohort >= date_trunc('month', NOW()) - INTERVAL '5 months'),
activity AS (
  SELECT f.cohort,
         ((EXTRACT(YEAR FROM p.created_at) - EXTRACT(YEAR FROM f.cohort)) * 12 + (EXTRACT(MONTH FROM p.created_at) - EXTRACT(MONTH FROM f.cohort)))::int AS m,
         COUNT(DISTINCT p.user_id) AS active
    FROM paid p JOIN recent f ON f.user_id = p.user_id
   GROUP BY f.cohort, m
)
SELECT to_char(c.cohort, 'YYYY-MM') AS cohort, c.size, a.m, a.active
  FROM (SELECT cohort, COUNT(*) AS size FROM recent GROUP BY cohort) c
  LEFT JOIN activity a ON a.cohort = c.cohort AND a.m BETWEEN 0 AND 5
 ORDER BY c.cohort, a.m
`

export const economicsSql = (w: CrmWindow, s: CrmSegment) => `
WITH ${segCte(s)}, ${PAID_CTE},
ltv AS (SELECT user_id, SUM(total_amount) AS ltv, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM paid GROUP BY user_id),
ranked AS (SELECT ltv, NTILE(10) OVER (ORDER BY ltv DESC) AS decile FROM ltv)
SELECT
  (SELECT COUNT(*) FROM ltv WHERE ltv < 1000) AS b_lt_1k,
  (SELECT COUNT(*) FROM ltv WHERE ltv >= 1000 AND ltv < 5000) AS b_1k_5k,
  (SELECT COUNT(*) FROM ltv WHERE ltv >= 5000 AND ltv < 25000) AS b_5k_25k,
  (SELECT COUNT(*) FROM ltv WHERE ltv >= 25000 AND ltv < 100000) AS b_25k_1l,
  (SELECT COUNT(*) FROM ltv WHERE ltv >= 100000) AS b_gte_1l,
  (SELECT SUM(ltv) FROM ranked WHERE decile = 1) AS top_decile_value,
  (SELECT SUM(ltv) FROM ltv) AS total_value,
  (SELECT AVG(total_amount) FROM paid WHERE created_at >= ${w.startExpr}) AS aov,
  (SELECT COUNT(*) FROM paid WHERE created_at >= ${w.startExpr}) AS paid_orders,
  (SELECT COALESCE(SUM(p.total_amount), 0) FROM paid p JOIN ltv l ON l.user_id = p.user_id WHERE p.created_at >= ${w.startExpr} AND l.first_at >= ${w.startExpr}) AS new_revenue,
  (SELECT COALESCE(SUM(p.total_amount), 0) FROM paid p JOIN ltv l ON l.user_id = p.user_id WHERE p.created_at >= ${w.startExpr} AND l.first_at < ${w.startExpr}) AS returning_revenue,
  (SELECT AVG(EXTRACT(EPOCH FROM (last_at - first_at)) / 86400 / (n - 1)) FROM ltv WHERE n >= 2) AS avg_days_between
`

export const aovBySegmentSql = (w: CrmWindow) => `
WITH ${CUSTOMER_AGG_CTE},
p AS (SELECT o.user_id, o.total_amount AS amount FROM orders o WHERE o.payment_status = 'paid' AND o.created_at >= ${w.startExpr})
SELECT
  ${segmentFilters('AVG(p.amount) FILTER (WHERE __PRED__)', '_aov')},
  ${segmentFilters('COUNT(*) FILTER (WHERE __PRED__)', '_orders')}
FROM p JOIN agg a ON a.id = p.user_id
`

export const returnRateBySegmentSql = (w: CrmWindow) => `
WITH ${CUSTOMER_AGG_CTE},
x AS (
  SELECT o.user_id, 'o' AS kind FROM orders o WHERE o.payment_status = 'paid' AND o.created_at >= ${w.startExpr}
  UNION ALL
  SELECT r.user_id, 'r' AS kind FROM return_requests r WHERE r.created_at >= ${w.startExpr}
)
SELECT
  ${segmentFilters("COUNT(*) FILTER (WHERE kind = 'o' AND __PRED__)", '_orders')},
  ${segmentFilters("COUNT(*) FILTER (WHERE kind = 'r' AND __PRED__)", '_returns')}
FROM x JOIN agg a ON a.id = x.user_id
`

export const healthAvgSql = (s: CrmSegment) => `
WITH ${segCte(s)}
SELECT COUNT(*) AS scored,
       AVG(ch.recency_score) AS recency, AVG(ch.frequency_score) AS frequency, AVG(ch.monetary_score) AS monetary,
       AVG(ch.engagement_score) AS engagement, AVG(ch.satisfaction_score) AS satisfaction
  FROM customer_health ch JOIN seg ON seg.id = ch.user_id
`

export const healthTransitionsSql = (s: CrmSegment) => `
WITH ${segCte(s)},
hist AS (SELECT h.user_id, h.churn_risk, h.snapshot_at FROM customer_health_history h JOIN seg ON seg.id = h.user_id),
base AS (SELECT DISTINCT ON (user_id) user_id, churn_risk AS from_risk FROM hist WHERE snapshot_at <= NOW() - INTERVAL '30 days' ORDER BY user_id, snapshot_at DESC),
cur AS (SELECT DISTINCT ON (user_id) user_id, churn_risk AS to_risk FROM hist ORDER BY user_id, snapshot_at DESC)
SELECT COUNT(*) AS compared,
       COUNT(*) FILTER (WHERE b.from_risk = 'healthy' AND c.to_risk = 'rising_concern') AS healthy_to_rising,
       COUNT(*) FILTER (WHERE b.from_risk = 'healthy' AND c.to_risk = 'high') AS healthy_to_high,
       COUNT(*) FILTER (WHERE b.from_risk = 'rising_concern' AND c.to_risk = 'high') AS rising_to_high,
       COUNT(*) FILTER (WHERE b.from_risk IN ('rising_concern', 'high') AND c.to_risk = 'healthy') AS recovered
  FROM base b JOIN cur c ON c.user_id = b.user_id
`

export const healthGainsSql = (s: CrmSegment) => `
WITH ${segCte(s)}
SELECT u.id, u.first_name, u.last_name, u.email, ch.score, ch.trend_delta_30d
  FROM customer_health ch JOIN users u ON u.id = ch.user_id JOIN seg ON seg.id = u.id
 WHERE ch.trend_delta_30d > 0
 ORDER BY ch.trend_delta_30d DESC, ch.score DESC LIMIT 5
`

export const CUSTOMER_SENDERS = "('user', 'customer')"

export const SESSION_STATE_CTE = `sess AS (
  SELECT ss.id, ss.user_id, ss.status, ss.created_at, ss.closed_at,
         MIN(m.created_at) FILTER (WHERE m.sender IN ${CUSTOMER_SENDERS}) AS first_customer,
         MAX(m.created_at) FILTER (WHERE m.sender IN ${CUSTOMER_SENDERS}) AS last_customer,
         MIN(m.created_at) FILTER (WHERE m.sender = 'admin') AS first_admin,
         (ARRAY_AGG(m.sender ORDER BY m.created_at DESC))[1] AS last_sender
    FROM support_sessions ss LEFT JOIN support_messages m ON m.session_id = ss.id
   GROUP BY ss.id
)`

export const UNANSWERED_INBOUND_WHERE = `ml.direction = 'inbound' AND NOT EXISTS (
  SELECT 1 FROM message_logs o
   WHERE o.direction = 'outbound' AND o.sent_at > ml.sent_at
     AND ((ml.user_id IS NOT NULL AND o.user_id = ml.user_id) OR (ml.from_number IS NOT NULL AND o.to_number = ml.from_number))
)`

export const serviceSql = (w: CrmWindow, s: CrmSegment) => `
WITH ${segCte(s)}, ${SESSION_STATE_CTE}
SELECT
  (SELECT COUNT(*) FROM sess ss WHERE ss.created_at >= ${w.startExpr}${scoped('ss', s)}) AS opened,
  (SELECT COUNT(*) FROM sess ss WHERE ss.closed_at >= ${w.startExpr}${scoped('ss', s)}) AS closed,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ss.first_admin - ss.first_customer)) / 60)
     FROM sess ss WHERE ss.created_at >= ${w.startExpr} AND ss.first_admin > ss.first_customer${scoped('ss', s)}) AS median_first_response_min,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ss.closed_at - ss.created_at)) / 60)
     FROM sess ss WHERE ss.closed_at IS NOT NULL AND ss.created_at >= ${w.startExpr}${scoped('ss', s)}) AS median_resolution_min,
  (SELECT COUNT(*) FROM sess ss WHERE ss.status = 'open' AND ss.last_sender IN ${CUSTOMER_SENDERS}${scoped('ss', s)}) AS unanswered_chats,
  (SELECT COUNT(DISTINCT COALESCE(ml.user_id::text, ml.from_number)) FROM message_logs ml WHERE ${UNANSWERED_INBOUND_WHERE}${scoped('ml', s)}) AS unanswered_inbound,
  (SELECT COUNT(*) FROM orders o WHERE o.payment_status = 'paid' AND o.created_at >= ${w.startExpr}${scoped('o', s)}) AS paid_orders,
  (SELECT COUNT(*) FROM product_reviews pr WHERE pr.created_at >= ${w.startExpr}${scoped('pr', s)}) AS reviews,
  (SELECT AVG(pr.rating) FROM product_reviews pr WHERE pr.created_at >= ${w.startExpr}${scoped('pr', s)}) AS avg_rating
`

export const lowReviewsSql = (startExpr: string, s: CrmSegment, limit: number) => `
WITH ${segCte(s)}
SELECT pr.id, pr.rating, pr.created_at, pr.product_id, p.name AS product_name,
       u.id AS user_id, u.first_name, u.last_name, u.email
  FROM product_reviews pr
  LEFT JOIN products p ON p.id = pr.product_id
  LEFT JOIN users u ON u.id = pr.user_id
 WHERE pr.created_at >= ${startExpr} AND pr.rating <= 2${scoped('pr', s)}
 ORDER BY pr.created_at DESC LIMIT ${limit}
`

export const reachSql = (w: CrmWindow, s: CrmSegment) => `
WITH ${segCte(s)}
SELECT
  (SELECT COUNT(*) FROM email_logs e WHERE e.sent_at >= ${w.startExpr}${scoped('e', s)}) AS email_sent,
  (SELECT COUNT(*) FROM email_logs e WHERE e.sent_at >= ${w.startExpr} AND (e.status NOT IN ('sent', 'delivered') OR e.error IS NOT NULL)${scoped('e', s)}) AS email_failed,
  (SELECT COUNT(*) FROM message_logs m WHERE m.channel = 'whatsapp' AND m.direction = 'outbound' AND m.sent_at >= ${w.startExpr}${scoped('m', s)}) AS whatsapp_sent,
  (SELECT COUNT(*) FROM message_logs m WHERE m.channel = 'whatsapp' AND m.direction = 'outbound' AND m.sent_at >= ${w.startExpr} AND (m.status NOT IN ('sent', 'delivered') OR m.error IS NOT NULL)${scoped('m', s)}) AS whatsapp_failed,
  (SELECT COUNT(*) FROM message_logs m WHERE m.channel = 'sms' AND m.direction = 'outbound' AND m.sent_at >= ${w.startExpr}${scoped('m', s)}) AS sms_sent,
  (SELECT COUNT(*) FROM message_logs m WHERE m.channel = 'sms' AND m.direction = 'outbound' AND m.sent_at >= ${w.startExpr} AND (m.status NOT IN ('sent', 'delivered') OR m.error IS NOT NULL)${scoped('m', s)}) AS sms_failed,
  (SELECT COUNT(*) FROM seg) AS customers,
  (SELECT COUNT(*) FROM users u JOIN seg ON seg.id = u.id WHERE NULLIF(TRIM(u.email), '') IS NOT NULL) AS has_email,
  (SELECT COUNT(*) FROM users u JOIN seg ON seg.id = u.id WHERE NULLIF(TRIM(u.phone), '') IS NOT NULL) AS has_phone,
  (SELECT COUNT(*) FROM users u JOIN seg ON seg.id = u.id WHERE u.marketing_opt_out = false) AS marketing_opt_in,
  (SELECT COUNT(*) FROM email_campaign_logs l WHERE l.sent_at >= ${w.startExpr} AND l.status = 'sent' AND l.error IS NULL) AS campaign_sent,
  (SELECT COUNT(*) FROM email_campaign_logs l WHERE l.sent_at >= ${w.startExpr} AND (l.status <> 'sent' OR l.error IS NOT NULL)) AS campaign_failed
`

export const intentSql = (s: CrmSegment) => `
WITH ${segCte(s)},
carts AS (
  SELECT ci.user_id, SUM(ci.quantity * ci.price_at_addition) AS value, MAX(ci.updated_at) AS last_upd
    FROM cart_items ci JOIN seg ON seg.id = ci.user_id WHERE ci.saved_for_later = false GROUP BY ci.user_id
),
abandoned AS (
  SELECT * FROM carts c
   WHERE c.last_upd < NOW() - INTERVAL '24 hours'
     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = c.user_id AND o.payment_status = 'paid' AND o.created_at >= c.last_upd)
)
SELECT
  COUNT(*) FILTER (WHERE last_upd >= NOW() - INTERVAL '3 days') AS a_1_3,
  COALESCE(SUM(value) FILTER (WHERE last_upd >= NOW() - INTERVAL '3 days'), 0) AS v_1_3,
  COUNT(*) FILTER (WHERE last_upd < NOW() - INTERVAL '3 days' AND last_upd >= NOW() - INTERVAL '7 days') AS a_3_7,
  COALESCE(SUM(value) FILTER (WHERE last_upd < NOW() - INTERVAL '3 days' AND last_upd >= NOW() - INTERVAL '7 days'), 0) AS v_3_7,
  COUNT(*) FILTER (WHERE last_upd < NOW() - INTERVAL '7 days') AS a_7p,
  COALESCE(SUM(value) FILTER (WHERE last_upd < NOW() - INTERVAL '7 days'), 0) AS v_7p,
  (SELECT COUNT(*) FROM cart_items ci JOIN seg ON seg.id = ci.user_id WHERE ci.saved_for_later = true) AS saved_for_later,
  (SELECT COUNT(*) FROM wishlist_items wi JOIN seg ON seg.id = wi.user_id) AS wishlist_items,
  (SELECT COUNT(*) FROM wishlist_items wi JOIN seg ON seg.id = wi.user_id JOIN products p ON p.id = wi.product_id
    WHERE CASE WHEN p.has_variants
               THEN EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND pv.inventory_quantity > 0)
               ELSE p.inventory_quantity > 0 END) AS wishlist_in_stock
FROM abandoned
`

export const topSearchesSql = (w: CrmWindow, s: CrmSegment) => `
WITH ${segCte(s)}
SELECT LOWER(TRIM(h.query)) AS q, COUNT(*) AS n
  FROM user_search_history h JOIN seg ON seg.id = h.user_id
 WHERE h.created_at >= ${w.startExpr} AND TRIM(h.query) <> ''
 GROUP BY 1 ORDER BY n DESC, q LIMIT 10
`

export const OPEN_TASK = "ct.status IN ('pending', 'in_progress')"

export const workloadSql = (w: CrmWindow, s: CrmSegment) => `
WITH ${segCte(s)}
SELECT COUNT(*) FILTER (WHERE ${OPEN_TASK}) AS open,
       COUNT(*) FILTER (WHERE ${OPEN_TASK} AND ct.due_date < CURRENT_DATE) AS overdue,
       COUNT(*) FILTER (WHERE ${OPEN_TASK} AND ct.auto_created) AS open_auto,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ct.completed_at - ct.created_at)) / 3600)
         FILTER (WHERE ct.status = 'completed' AND ct.completed_at >= ${w.startExpr} AND ct.completed_at > ct.created_at) AS median_hours
  FROM customer_tasks ct WHERE TRUE${scoped('ct', s)}
`

export const tasksByAssigneeSql = (s: CrmSegment) => `
WITH ${segCte(s)}
SELECT ct.assigned_to, au.first_name, au.last_name, COUNT(*) AS open,
       COUNT(*) FILTER (WHERE ct.due_date < CURRENT_DATE) AS overdue
  FROM customer_tasks ct
  LEFT JOIN admins a ON a.id = ct.assigned_to
  LEFT JOIN users au ON au.id = a.user_id
 WHERE ${OPEN_TASK}${scoped('ct', s)}
 GROUP BY ct.assigned_to, au.first_name, au.last_name
 ORDER BY open DESC LIMIT 10
`

export const notesPerWeekSql = (s: CrmSegment) => `
WITH ${segCte(s)}
SELECT to_char(g.wk, 'YYYY-MM-DD') AS week, COUNT(cn.id) AS n
  FROM generate_series(date_trunc('week', NOW()) - INTERVAL '7 weeks', date_trunc('week', NOW()), INTERVAL '1 week') AS g(wk)
  LEFT JOIN customer_notes cn ON date_trunc('week', cn.created_at) = g.wk${scoped('cn', s)}
 GROUP BY g.wk ORDER BY g.wk
`

export const OPEN_QUOTE =
  "q.converted_order_id IS NULL AND COALESCE(q.status, '') NOT IN ('rejected', 'expired', 'cancelled', 'converted')"

export const b2bSql = (w: CrmWindow) => `
SELECT
  (SELECT COUNT(*) FROM business_profiles bp WHERE bp.approval_status = 'pending') AS pending_approvals,
  (SELECT COUNT(*) FROM business_rfqs r WHERE r.converted_quotation_id IS NULL AND r.status NOT IN ('rejected', 'converted')) AS open_rfqs,
  (SELECT COUNT(*) FROM business_rfqs r WHERE r.created_at >= ${w.startExpr}) AS rfqs_in_range,
  (SELECT COUNT(*) FROM business_rfqs r WHERE r.created_at >= ${w.startExpr} AND r.converted_quotation_id IS NOT NULL) AS rfqs_converted,
  (SELECT COUNT(*) FROM quotations q WHERE ${OPEN_QUOTE}) AS open_quotes,
  (SELECT COALESCE(SUM(q.total_amount), 0) FROM quotations q WHERE ${OPEN_QUOTE}) AS open_quotes_value,
  (SELECT COUNT(*) FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE u.is_guest = false AND cp.credit_limit > 0) AS credit_customers,
  (SELECT COALESCE(SUM(cp.credit_limit), 0) FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE u.is_guest = false AND cp.credit_limit > 0) AS credit_limit_total,
  (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o JOIN customer_profiles cp ON cp.user_id = o.user_id
    WHERE cp.credit_limit > 0 AND o.payment_status <> 'paid' AND o.status NOT IN ('cancelled', 'returned')) AS credit_used
`

const ADDR = (field: string) => `NULLIF(TRIM(COALESCE(o.shipping_address_snapshot->>'${field}', a.${field})), '')`

export const geographySql = (w: CrmWindow, s: CrmSegment, by: 'state' | 'city') => `
WITH ${segCte(s)}
SELECT ${ADDR(by)} AS name, ${by === 'city' ? `${ADDR('state')} AS state,` : ''}
       COUNT(DISTINCT o.user_id) AS customers, COALESCE(SUM(o.total_amount), 0) AS revenue
  FROM orders o JOIN seg ON seg.id = o.user_id LEFT JOIN addresses a ON a.id = o.shipping_address_id
 WHERE o.payment_status = 'paid' AND o.created_at >= ${w.startExpr} AND ${ADDR(by)} IS NOT NULL
 GROUP BY 1${by === 'city' ? ', 2' : ''} ORDER BY revenue DESC, customers DESC LIMIT 10
`
