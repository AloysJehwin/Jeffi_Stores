import type { AttentionItem } from '@/components/admin/overview/kit'
import type { Bucket } from '@/lib/overview/period'
import { ratio } from '@/lib/overview/period'
import { BOUNDS, bucketsCte, inBucket, num, numOrNull, periodCase, realized, str } from './marketing'

// Coupon redemptions come from coupon_usage; revenue counts only realized orders (CRM rule).

export const KPI_SQL = `
WITH ${BOUNDS},
u AS (
  SELECT cu.*, ${periodCase('cu.created_at')} AS period
    FROM coupon_usage cu, b
   WHERE cu.created_at >= b.p0 AND cu.created_at < b.c1
),
ord AS (
  SELECT DISTINCT u.period, o.id, o.total_amount
    FROM u JOIN orders o ON o.id = u.order_id
   WHERE ${realized('o')}
)
SELECT p.period,
       (SELECT COUNT(*) FROM u WHERE u.period = p.period) AS redemptions,
       (SELECT COUNT(DISTINCT u.user_id) FROM u WHERE u.period = p.period) AS customers,
       (SELECT COUNT(DISTINCT u.coupon_id) FROM u WHERE u.period = p.period) AS coupons_used,
       (SELECT COALESCE(SUM(u.discount_amount), 0) FROM u WHERE u.period = p.period) AS discount,
       (SELECT COUNT(*) FROM ord WHERE ord.period = p.period) AS coupon_orders,
       (SELECT COALESCE(SUM(ord.total_amount), 0) FROM ord WHERE ord.period = p.period) AS coupon_revenue,
       (SELECT COUNT(*) FROM orders o WHERE ${realized('o')} AND ${periodCase('o.created_at')} = p.period
          AND o.created_at >= b.p0 AND o.created_at < b.c1) AS all_orders,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE ${realized('o')} AND ${periodCase('o.created_at')} = p.period
          AND o.created_at >= b.p0 AND o.created_at < b.c1) AS all_revenue
  FROM (VALUES ('cur'), ('prev')) p(period), b
`

export const seriesSql = (bucket: Bucket) => `
WITH ${BOUNDS}, ${bucketsCte(bucket)}
SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
       COUNT(cu.id) AS redemptions,
       COALESCE(SUM(cu.discount_amount), 0) AS discount
  FROM k CROSS JOIN b
  LEFT JOIN coupon_usage cu ON cu.created_at >= b.c0 AND cu.created_at < b.c1 AND ${inBucket('cu.created_at', bucket)}
 GROUP BY k.bucket ORDER BY k.bucket
`

export const TOP_SQL = `
WITH ${BOUNDS},
u AS (SELECT cu.* FROM coupon_usage cu, b WHERE cu.created_at >= b.c0 AND cu.created_at < b.c1)
SELECT c.id, c.code, c.discount_type, c.discount_value, c.auto_generated, c.generated_for_campaign,
       COUNT(u.id) AS redemptions,
       COUNT(DISTINCT u.user_id) AS customers,
       COALESCE(SUM(u.discount_amount), 0) AS discount,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o
         WHERE ${realized('o')} AND o.id IN (SELECT x.order_id FROM u x WHERE x.coupon_id = c.id)) AS revenue
  FROM u JOIN coupons c ON c.id = u.coupon_id
 GROUP BY c.id
 ORDER BY redemptions DESC, discount DESC
 LIMIT 10
`

export const SOURCE_SQL = `
WITH ${BOUNDS}
SELECT COALESCE(NULLIF(c.generated_for_campaign, ''), CASE WHEN c.auto_generated THEN 'auto' ELSE 'manual' END) AS source,
       COUNT(cu.id) AS redemptions,
       COALESCE(SUM(cu.discount_amount), 0) AS discount
  FROM coupon_usage cu JOIN coupons c ON c.id = cu.coupon_id, b
 WHERE cu.created_at >= b.c0 AND cu.created_at < b.c1
 GROUP BY 1 ORDER BY redemptions DESC
`

// Live state, not period-bound. Personal auto-generated coupons are left out of the "unused" list.
export const STATE_SQL = `
SELECT COUNT(*) FILTER (WHERE is_active AND NOT is_draft AND (valid_until IS NULL OR valid_until > NOW())) AS active,
       COUNT(*) FILTER (WHERE is_draft) AS drafts,
       COUNT(*) FILTER (WHERE is_active AND NOT is_draft AND valid_until > NOW() AND valid_until <= NOW() + INTERVAL '7 days') AS expiring,
       COUNT(*) FILTER (WHERE is_active AND NOT is_draft AND valid_until <= NOW()) AS expired_active,
       COUNT(*) FILTER (WHERE is_active AND NOT is_draft AND usage_limit IS NOT NULL AND times_used >= usage_limit) AS exhausted,
       COUNT(*) FILTER (WHERE is_active AND NOT is_draft AND usage_limit IS NOT NULL AND times_used < usage_limit
                          AND times_used >= usage_limit * 0.8) AS near_limit,
       COUNT(*) FILTER (WHERE is_active AND NOT is_draft AND NOT COALESCE(auto_generated, false) AND times_used = 0
                          AND created_at < NOW() - INTERVAL '14 days' AND (valid_until IS NULL OR valid_until > NOW())) AS unused
  FROM coupons
`

export const EXPIRING_SQL = `
SELECT id, code, valid_until, times_used, usage_limit
  FROM coupons
 WHERE is_active AND NOT is_draft AND valid_until > NOW() AND valid_until <= NOW() + INTERVAL '7 days'
 ORDER BY valid_until LIMIT 8
`

export const UNUSED_SQL = `
SELECT id, code, created_at, valid_until, discount_type, discount_value
  FROM coupons
 WHERE is_active AND NOT is_draft AND NOT COALESCE(auto_generated, false) AND times_used = 0
   AND created_at < NOW() - INTERVAL '14 days' AND (valid_until IS NULL OR valid_until > NOW())
 ORDER BY created_at LIMIT 8
`

export interface CouponTotals {
  redemptions: number
  customers: number
  coupons_used: number
  discount: number
  coupon_orders: number
  coupon_revenue: number
  all_orders: number
  all_revenue: number
  /** discount / (coupon revenue + discount): how much of the gross price was given away. */
  discount_rate: number | null
  /** Share of realized orders that used a coupon. */
  order_share: number | null
  /** Share of realized revenue on coupon orders. */
  revenue_share: number | null
}

export function toTotals(r: Record<string, unknown> | undefined): CouponTotals {
  const t = {
    redemptions: num(r?.redemptions),
    customers: num(r?.customers),
    coupons_used: num(r?.coupons_used),
    discount: num(r?.discount),
    coupon_orders: num(r?.coupon_orders),
    coupon_revenue: num(r?.coupon_revenue),
    all_orders: num(r?.all_orders),
    all_revenue: num(r?.all_revenue),
  }
  return {
    ...t,
    discount_rate: ratio(t.discount, t.coupon_revenue + t.discount),
    order_share: ratio(t.coupon_orders, t.all_orders),
    revenue_share: ratio(t.coupon_revenue, t.all_revenue),
  }
}

export interface CouponState {
  active: number
  drafts: number
  expiring: number
  expired_active: number
  exhausted: number
  near_limit: number
  unused: number
}

export const toState = (r: Record<string, unknown> | undefined): CouponState => ({
  active: num(r?.active),
  drafts: num(r?.drafts),
  expiring: num(r?.expiring),
  expired_active: num(r?.expired_active),
  exhausted: num(r?.exhausted),
  near_limit: num(r?.near_limit),
  unused: num(r?.unused),
})

export const toTopCoupon = (r: Record<string, unknown>) => ({
  id: str(r.id),
  code: str(r.code),
  discount_type: str(r.discount_type),
  discount_value: numOrNull(r.discount_value),
  source: r.generated_for_campaign ? str(r.generated_for_campaign) : r.auto_generated ? 'auto' : 'manual',
  redemptions: num(r.redemptions),
  customers: num(r.customers),
  discount: num(r.discount),
  revenue: num(r.revenue),
})

/** Above this share of gross price given away, coupons are flagged. */
export const HIGH_DISCOUNT_RATE = 0.2

export function couponAttention(state: CouponState, cur: CouponTotals): AttentionItem[] {
  const out: AttentionItem[] = []
  const list = '/admin/coupons?tab=list&is_active=true'
  if (state.exhausted)
    out.push({
      key: 'exhausted',
      severity: 'warning',
      title: `${state.exhausted} active coupon${state.exhausted === 1 ? ' has' : 's have'} hit the usage limit`,
      sub: 'Customers can no longer apply them; raise the limit or switch them off.',
      href: list,
    })
  if (state.expiring)
    out.push({
      key: 'expiring',
      severity: 'warning',
      title: `${state.expiring} coupon${state.expiring === 1 ? '' : 's'} expire within 7 days`,
      href: list,
    })
  if (state.near_limit)
    out.push({
      key: 'near_limit',
      severity: 'info',
      title: `${state.near_limit} coupon${state.near_limit === 1 ? ' is' : 's are'} past 80% of the usage limit`,
      href: list,
    })
  if (cur.discount_rate != null && cur.discount_rate > HIGH_DISCOUNT_RATE && cur.redemptions >= 5)
    out.push({
      key: 'discount_rate',
      severity: 'warning',
      title: `Coupons gave away ${(cur.discount_rate * 100).toFixed(1)}% of the price on coupon orders`,
      sub: 'Check the high-value coupons in the top list.',
      href: '/admin/coupons?tab=list',
    })
  if (state.unused)
    out.push({
      key: 'unused',
      severity: 'info',
      title: `${state.unused} active coupon${state.unused === 1 ? ' has' : 's have'} never been used in 14+ days`,
      sub: 'Promote them or switch them off.',
      href: list,
    })
  if (state.expired_active)
    out.push({
      key: 'expired_active',
      severity: 'info',
      title: `${state.expired_active} expired coupon${state.expired_active === 1 ? ' is' : 's are'} still marked active`,
      href: list,
    })
  return out
}
