import type { AttentionItem } from '@/components/admin/overview/kit'
import { ratio } from '@/lib/overview/period'
import { BOUNDS, num, periodCase, realized, str } from './marketing'

// Strip for the customers list. Depth (cohorts, LTV, health) lives on /admin/crm.

export const KPI_SQL = `
WITH ${BOUNDS},
nu AS (
  SELECT ${periodCase('u.created_at')} AS period, u.is_guest
    FROM users u, b
   WHERE u.created_at >= b.p0 AND u.created_at < b.c1 AND u.merged_to_user_id IS NULL
),
ro AS (
  SELECT ${periodCase('o.created_at')} AS period, o.user_id, o.total_amount, COALESCE(u.is_guest, true) AS guest
    FROM orders o LEFT JOIN users u ON u.id = o.user_id, b
   WHERE ${realized('o')} AND o.created_at >= b.p0 AND o.created_at < b.c1
),
life AS (
  SELECT o.user_id,
         COUNT(*) FILTER (WHERE o.created_at < b.c0) AS before_cur,
         COUNT(*) AS through_cur
    FROM orders o JOIN users u ON u.id = o.user_id AND u.is_guest = false, b
   WHERE ${realized('o')} AND o.created_at < b.c1
   GROUP BY o.user_id
),
buyers AS (SELECT DISTINCT period, user_id FROM ro WHERE NOT guest)
SELECT p.period,
       (SELECT COUNT(*) FROM nu WHERE nu.period = p.period AND NOT nu.is_guest) AS new_accounts,
       (SELECT COUNT(*) FROM nu WHERE nu.period = p.period AND nu.is_guest) AS new_guests,
       (SELECT COUNT(*) FROM buyers WHERE buyers.period = p.period) AS active_buyers,
       (SELECT COUNT(*) FROM buyers JOIN life l USING (user_id)
         WHERE buyers.period = p.period
           AND (CASE WHEN p.period = 'cur' THEN l.through_cur ELSE l.before_cur END) >= 2) AS repeat_buyers,
       (SELECT COUNT(*) FROM ro WHERE ro.period = p.period AND NOT ro.guest) AS account_orders,
       (SELECT COUNT(*) FROM ro WHERE ro.period = p.period AND ro.guest) AS guest_orders,
       (SELECT COALESCE(SUM(total_amount), 0) FROM ro WHERE ro.period = p.period) AS revenue
  FROM (VALUES ('cur'), ('prev')) p(period)
`

export const STATES_SQL = `
WITH ${BOUNDS}
SELECT COALESCE(NULLIF(TRIM(o.shipping_address_snapshot->>'state'), ''), 'Unknown') AS state,
       COUNT(*) AS orders,
       COUNT(DISTINCT COALESCE(o.user_id::text, o.customer_email)) AS customers,
       COALESCE(SUM(o.total_amount), 0) AS revenue
  FROM orders o, b
 WHERE ${realized('o')} AND o.created_at >= b.c0 AND o.created_at < b.c1
 GROUP BY 1 ORDER BY orders DESC LIMIT 6
`

export const STATE_SQL = `
SELECT (SELECT COUNT(*) FROM users WHERE is_flagged AND merged_to_user_id IS NULL) AS flagged,
       (SELECT COUNT(*) FROM users u WHERE u.is_guest = false AND u.merged_to_user_id IS NULL
           AND u.created_at > NOW() - INTERVAL '30 days'
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)) AS new_no_order,
       (SELECT COUNT(*) FROM users WHERE is_guest = false AND merged_to_user_id IS NULL) AS total_accounts
`

export interface CustomerTotals {
  new_accounts: number
  new_guests: number
  active_buyers: number
  repeat_buyers: number
  account_orders: number
  guest_orders: number
  revenue: number
  repeat_rate: number | null
  guest_share: number | null
}

export function toCustomerTotals(r: Record<string, unknown> | undefined): CustomerTotals {
  const t = {
    new_accounts: num(r?.new_accounts),
    new_guests: num(r?.new_guests),
    active_buyers: num(r?.active_buyers),
    repeat_buyers: num(r?.repeat_buyers),
    account_orders: num(r?.account_orders),
    guest_orders: num(r?.guest_orders),
    revenue: num(r?.revenue),
  }
  return {
    ...t,
    repeat_rate: ratio(t.repeat_buyers, t.active_buyers),
    guest_share: ratio(t.guest_orders, t.account_orders + t.guest_orders),
  }
}

export const toStateRow = (r: Record<string, unknown>) => ({
  state: str(r.state),
  orders: num(r.orders),
  customers: num(r.customers),
  revenue: num(r.revenue),
})

export interface CustomerState {
  flagged: number
  new_no_order: number
  total_accounts: number
}

export const toCustomerState = (r: Record<string, unknown> | undefined): CustomerState => ({
  flagged: num(r?.flagged),
  new_no_order: num(r?.new_no_order),
  total_accounts: num(r?.total_accounts),
})

/** Guest orders above this share get a nudge to push sign-up at checkout. */
export const HIGH_GUEST_SHARE = 0.5

export function customerAttention(state: CustomerState, cur: CustomerTotals, prev: CustomerTotals): AttentionItem[] {
  const out: AttentionItem[] = []
  if (state.flagged)
    out.push({
      key: 'flagged',
      severity: 'warning',
      title: `${state.flagged} flagged customer${state.flagged === 1 ? '' : 's'}`,
      sub: 'Review before their next order ships.',
      href: '/admin/customers?status=flagged',
    })
  if (state.new_no_order)
    out.push({
      key: 'new_no_order',
      severity: 'info',
      title: `${state.new_no_order} account${state.new_no_order === 1 ? '' : 's'} from the last 30 days without an order`,
      sub: 'A welcome coupon or follow-up can convert them.',
      href: '/admin/customers?segment=lead',
    })
  if (cur.guest_share != null && cur.guest_share > HIGH_GUEST_SHARE && cur.account_orders + cur.guest_orders >= 10)
    out.push({
      key: 'guests',
      severity: 'info',
      title: `${(cur.guest_share * 100).toFixed(0)}% of orders came from guests`,
      sub: 'Guests cannot be reached by loyalty or campaigns.',
    })
  if (prev.new_accounts >= 10 && cur.new_accounts < prev.new_accounts * 0.5)
    out.push({
      key: 'signups_drop',
      severity: 'warning',
      title: `New accounts fell from ${prev.new_accounts} to ${cur.new_accounts}`,
    })
  return out
}
