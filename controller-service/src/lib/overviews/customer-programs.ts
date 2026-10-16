import type { AttentionItem } from '@/components/admin/overview/kit'
import type { Bucket } from '@/lib/overview/period'
import { ratio } from '@/lib/overview/period'
import { BOUNDS, bucketsCte, inBucket, num, periodCase, realized, str } from './marketing'

// Loyalty from loyalty_ledger (redeemed uses the same reasons as getLoyaltyStats); referrals from
// referrals (invites) and referral_signups.

const ISSUED = `delta > 0 AND reason <> 'redeem_refund'`
const REDEEMED = `reason IN ('redeem', 'redeem_refund')`
const REVERSED = `reason IN ('order_reversal', 'referral_reversal')`

export const LOYALTY_KPI_SQL = `
WITH ${BOUNDS},
l AS (
  SELECT ll.*, ${periodCase('ll.created_at')} AS period
    FROM loyalty_ledger ll, b
   WHERE ll.created_at >= b.p0 AND ll.created_at < b.c1 AND ll.delta <> 0
),
firsts AS (SELECT user_id, MIN(created_at) AS first_at FROM loyalty_ledger WHERE delta <> 0 GROUP BY user_id)
SELECT p.period,
       (SELECT COALESCE(SUM(delta) FILTER (WHERE ${ISSUED}), 0) FROM l WHERE l.period = p.period) AS issued,
       (SELECT COALESCE(-SUM(delta) FILTER (WHERE ${REDEEMED}), 0) FROM l WHERE l.period = p.period) AS redeemed,
       (SELECT COALESCE(-SUM(delta) FILTER (WHERE ${REVERSED}), 0) FROM l WHERE l.period = p.period) AS reversed,
       (SELECT COUNT(*) FILTER (WHERE reason = 'redeem') FROM l WHERE l.period = p.period) AS redemptions,
       (SELECT COUNT(DISTINCT user_id) FROM l WHERE l.period = p.period) AS active_members,
       (SELECT COUNT(DISTINCT order_id) FILTER (WHERE reason = 'order_earn') FROM l WHERE l.period = p.period) AS earning_orders,
       (SELECT COUNT(*) FROM firsts f WHERE f.first_at >= (CASE WHEN p.period = 'cur' THEN b.c0 ELSE b.p0 END)
          AND f.first_at < (CASE WHEN p.period = 'cur' THEN b.c1 ELSE b.c0 END)) AS new_members
  FROM (VALUES ('cur'), ('prev')) p(period), b
`

export const loyaltySeriesSql = (bucket: Bucket) => `
WITH ${BOUNDS}, ${bucketsCte(bucket)}
SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
       COALESCE(SUM(ll.delta) FILTER (WHERE ll.delta > 0 AND ll.reason <> 'redeem_refund'), 0) AS issued,
       COALESCE(-SUM(ll.delta) FILTER (WHERE ll.reason IN ('redeem', 'redeem_refund')), 0) AS redeemed
  FROM k CROSS JOIN b
  LEFT JOIN loyalty_ledger ll ON ll.created_at >= b.c0 AND ll.created_at < b.c1 AND ${inBucket('ll.created_at', bucket)}
 GROUP BY k.bucket ORDER BY k.bucket
`

/** Members at or above the redeem minimum ($1). */
export const REDEEMABLE_SQL = `SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS points FROM loyalty_accounts WHERE points >= $1`

export const TOP_EARNERS_SQL = `
WITH ${BOUNDS}
SELECT u.id, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS name, u.email,
       SUM(ll.delta) FILTER (WHERE ll.delta > 0 AND ll.reason <> 'redeem_refund') AS earned,
       COALESCE(-SUM(ll.delta) FILTER (WHERE ll.reason IN ('redeem', 'redeem_refund')), 0) AS redeemed,
       la.points, la.tier
  FROM loyalty_ledger ll JOIN users u ON u.id = ll.user_id
  LEFT JOIN loyalty_accounts la ON la.user_id = ll.user_id, b
 WHERE ll.created_at >= b.c0 AND ll.created_at < b.c1
 GROUP BY u.id, la.points, la.tier
HAVING SUM(ll.delta) FILTER (WHERE ll.delta > 0 AND ll.reason <> 'redeem_refund') > 0
 ORDER BY earned DESC LIMIT 8
`

export const REFERRAL_KPI_SQL = `
WITH ${BOUNDS},
s AS (SELECT rs.* FROM referral_signups rs, b WHERE rs.signed_up_at < b.c1),
ro AS (
  SELECT o.user_id, o.id, o.created_at, o.total_amount,
         ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.created_at, o.id) AS rn
    FROM orders o
   WHERE ${realized('o')} AND o.user_id IN (SELECT referred_user_id FROM s)
)
SELECT p.period,
       (SELECT COUNT(*) FROM referrals r WHERE r.invited_at >= lo AND r.invited_at < hi) AS invites,
       (SELECT COUNT(*) FROM s WHERE s.signed_up_at >= lo AND s.signed_up_at < hi) AS signups,
       (SELECT COUNT(*) FROM s WHERE s.rewarded_at >= lo AND s.rewarded_at < hi) AS rewarded,
       (SELECT COUNT(*) FROM s WHERE s.status = 'rejected' AND s.signed_up_at >= lo AND s.signed_up_at < hi) AS rejected,
       (SELECT COUNT(*) FROM ro WHERE ro.rn = 1 AND ro.created_at >= lo AND ro.created_at < hi) AS first_orders,
       (SELECT COUNT(*) FROM ro WHERE ro.created_at >= lo AND ro.created_at < hi) AS orders,
       (SELECT COALESCE(SUM(total_amount), 0) FROM ro WHERE ro.created_at >= lo AND ro.created_at < hi) AS revenue,
       (SELECT COALESCE(SUM(delta), 0) FROM loyalty_ledger ll WHERE ll.reason IN ('referral', 'referral_reversal')
          AND ll.created_at >= lo AND ll.created_at < hi) AS points_paid
  FROM (VALUES ('cur'), ('prev')) p(period), b,
       LATERAL (SELECT CASE WHEN p.period = 'cur' THEN b.c0 ELSE b.p0 END AS lo,
                       CASE WHEN p.period = 'cur' THEN b.c1 ELSE b.c0 END AS hi) w
`

export const TOP_REFERRERS_SQL = `
WITH ${BOUNDS},
s AS (SELECT rs.* FROM referral_signups rs, b WHERE rs.signed_up_at >= b.c0 AND rs.signed_up_at < b.c1)
SELECT u.id, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS name, u.email,
       COUNT(*) AS signups,
       COUNT(*) FILTER (WHERE s.status = 'rewarded') AS rewarded,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o, b
         WHERE ${realized('o')} AND o.created_at >= b.c0 AND o.created_at < b.c1
           AND o.user_id IN (SELECT x.referred_user_id FROM s x WHERE x.referrer_user_id = u.id)) AS revenue
  FROM s JOIN users u ON u.id = s.referrer_user_id
 GROUP BY u.id ORDER BY signups DESC, revenue DESC LIMIT 8
`

/** Signed up more than `qualifyDays` ($1) ago and still waiting on a qualifying order. */
export const STALE_JOINED_SQL = `
SELECT COUNT(*) AS n FROM referral_signups
 WHERE status = 'joined' AND signed_up_at < NOW() - make_interval(days => $1::int)
`

export interface LoyaltyTotals {
  issued: number
  redeemed: number
  reversed: number
  redemptions: number
  active_members: number
  earning_orders: number
  new_members: number
  /** Points redeemed per point issued in the period. */
  redeem_rate: number | null
}

export function toLoyaltyTotals(r: Record<string, unknown> | undefined): LoyaltyTotals {
  const t = {
    issued: num(r?.issued),
    redeemed: num(r?.redeemed),
    reversed: num(r?.reversed),
    redemptions: num(r?.redemptions),
    active_members: num(r?.active_members),
    earning_orders: num(r?.earning_orders),
    new_members: num(r?.new_members),
  }
  return { ...t, redeem_rate: ratio(t.redeemed, t.issued) }
}

export interface ReferralTotals {
  invites: number
  signups: number
  rewarded: number
  rejected: number
  first_orders: number
  orders: number
  revenue: number
  points_paid: number
  /** Signups per invite sent. */
  signup_rate: number | null
}

export function toReferralTotals(r: Record<string, unknown> | undefined): ReferralTotals {
  const t = {
    invites: num(r?.invites),
    signups: num(r?.signups),
    rewarded: num(r?.rewarded),
    rejected: num(r?.rejected),
    first_orders: num(r?.first_orders),
    orders: num(r?.orders),
    revenue: num(r?.revenue),
    points_paid: num(r?.points_paid),
  }
  return { ...t, signup_rate: ratio(t.signups, t.invites) }
}

export const toPerson = (r: Record<string, unknown>) => ({
  id: str(r.id),
  name: r.name ? str(r.name) : str(r.email) || 'Customer',
  email: str(r.email),
})

export interface ProgramFacts {
  loyaltyOn: boolean
  referralsOn: boolean
  liability: number
  outstandingPoints: number
  redeemableMembers: number
  minRedeemPoints: number
  staleJoined: number
  qualifyDays: number
}

export function programAttention(f: ProgramFacts, loyalty: LoyaltyTotals, referrals: ReferralTotals): AttentionItem[] {
  const out: AttentionItem[] = []
  const controls = '/admin/settings/site-controls'
  if (!f.loyaltyOn && f.outstandingPoints > 0)
    out.push({
      key: 'loyalty_off',
      severity: 'warning',
      title: 'Loyalty is switched off but members still hold points',
      sub: `${f.outstandingPoints.toLocaleString('en-IN')} points cannot be redeemed.`,
      href: controls,
    })
  if (!f.referralsOn)
    out.push({ key: 'referrals_off', severity: 'info', title: 'Refer & Earn is switched off', href: controls })
  if (f.loyaltyOn && f.redeemableMembers > 0 && loyalty.redemptions === 0)
    out.push({
      key: 'redeemable',
      severity: 'info',
      title: `${f.redeemableMembers} member${f.redeemableMembers === 1 ? ' has' : 's have'} enough points to redeem and none redeemed this period`,
      sub: `Minimum is ${f.minRedeemPoints} points; a reminder campaign can bring them back.`,
      href: '/admin/customer-programs?tab=loyalty',
    })
  if (f.staleJoined)
    out.push({
      key: 'stale_joined',
      severity: 'info',
      title: `${f.staleJoined} referred signup${f.staleJoined === 1 ? ' has' : 's have'} not ordered within ${f.qualifyDays} days`,
      href: '/admin/customer-programs?tab=referrals&status=joined',
    })
  if (referrals.rejected)
    out.push({
      key: 'rejected',
      severity: 'info',
      title: `${referrals.rejected} referral${referrals.rejected === 1 ? ' was' : 's were'} rejected this period`,
      href: '/admin/customer-programs?tab=referrals&status=rejected',
    })
  if (loyalty.reversed > loyalty.issued * 0.25 && loyalty.reversed > 0)
    out.push({
      key: 'reversals',
      severity: 'warning',
      title: `${loyalty.reversed.toLocaleString('en-IN')} points reversed against ${loyalty.issued.toLocaleString('en-IN')} issued`,
      sub: 'High reversals usually mean many cancelled or returned orders.',
    })
  return out
}
