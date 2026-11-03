import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { SUBSCRIPTION_FIELDS } from '../fields/subscriptions'

type SubscriptionKey = FieldKeys<typeof SUBSCRIPTION_FIELDS>

// Per-cycle amount in paise, as on the list and its stats.
export const CYCLE_PAISE_SQL = `(COALESCE(s.unit_price_paise, 0) * s.quantity + s.shipping_paise)`
const ist = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

const SQL: Record<SubscriptionKey, FieldSql> = {
  status: { kind: 'enum', expr: 's.status' },
  interval: { kind: 'enum', expr: 's.interval' },
  product: { kind: 'values', lateral: { from: 'products p', link: 'p.id = s.product_id', expr: 'p.name' } },
  digital: { kind: 'bool', expr: 'COALESCE(s.is_digital, false)' },
  source: { kind: 'values', expr: 's.source' },
  price: { kind: 'range', expr: `(${CYCLE_PAISE_SQL} / 100.0)` },

  created: { kind: 'date', expr: 's.created_at' },
  renewal: { kind: 'date', expr: 'COALESCE(s.current_end, s.next_renewal_at)' },
  cancel_at_end: { kind: 'bool', expr: 'COALESCE(s.cancel_at_cycle_end, false)' },
  paused: { kind: 'bool', expr: 's.paused_at IS NOT NULL' },
}

export const SUBSCRIPTIONS_ENTITY: FilterEntity<SubscriptionKey> = {
  key: 'subscriptions',
  scope: 'subscriptions:read',
  noun: 'Subscriptions',
  root: 'subscriptions',
  alias: 's',
  // Razorpay-backed subscriptions only; legacy rows are not managed here.
  base: ["s.source <> 'legacy'"],
  fields: SUBSCRIPTION_FIELDS,
  sql: SQL,
  period: 'created',
  search: {
    build: (q, idx) => ({
      clause: `(EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id
          AND (u.email ILIKE $${idx} OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $${idx}))
        OR EXISTS (SELECT 1 FROM products p WHERE p.id = s.product_id AND p.name ILIKE $${idx})
        OR s.razorpay_subscription_id ILIKE $${idx})`,
      params: [`%${escapeLike(q)}%`],
      nextIdx: idx + 1,
    }),
  },
  facets: true,
  export: {
    columns: [
      { key: 'id', label: 'Subscription', sql: 's.id' },
      { key: 'status', label: 'Status', sql: 's.status' },
      {
        key: 'customer',
        label: 'Customer',
        sql: "(SELECT NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') FROM users u WHERE u.id = s.user_id)",
      },
      { key: 'email', label: 'Email', sql: '(SELECT u.email FROM users u WHERE u.id = s.user_id)' },
      { key: 'product', label: 'Product', sql: '(SELECT p.name FROM products p WHERE p.id = s.product_id)' },
      { key: 'interval', label: 'Plan', sql: 's.interval' },
      { key: 'quantity', label: 'Quantity', sql: 's.quantity' },
      { key: 'amount', label: 'Amount per cycle', sql: `round(${CYCLE_PAISE_SQL} / 100.0, 2)` },
      { key: 'current_cycle', label: 'Current cycle', sql: 's.current_cycle' },
      { key: 'term_cycles', label: 'Total cycles', sql: 's.term_cycles' },
      { key: 'next_renewal', label: 'Next renewal (IST)', sql: ist('COALESCE(s.current_end, s.next_renewal_at)') },
      { key: 'cancel_at_end', label: 'Cancels at cycle end', sql: 'COALESCE(s.cancel_at_cycle_end, false)' },
      { key: 'digital', label: 'Digital', sql: 'COALESCE(s.is_digital, false)' },
      { key: 'razorpay_id', label: 'Razorpay subscription', sql: 's.razorpay_subscription_id' },
      { key: 'created', label: 'Started (IST)', sql: ist('s.created_at') },
    ],
    keyset: ['s.created_at', 's.id'],
  },
}
