import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { buildSearchClause } from '@/lib/catalog/search'
import { CUSTOMER_FIELDS } from '../fields/customers'

type CustomerKey = FieldKeys<typeof CUSTOMER_FIELDS>

const userOrders = (agg: string) => `(SELECT ${agg} FROM orders x WHERE x.user_id = u.id)`
// The customer's order totals as one row `o`, named like the list's columns, so segments read as before.
const stats = (cond: string) =>
  `(SELECT ${cond} FROM (SELECT COUNT(*) AS order_count, COUNT(*) FILTER (WHERE x.payment_status = 'paid') AS paid_orders,
      MAX(x.created_at) AS last_order_at, SUM(x.total_amount) AS lifetime_value
    FROM orders x WHERE x.user_id = u.id) o)`
const health = (cond: string) =>
  `(SELECT ${cond} FROM (SELECT (SELECT h.score FROM customer_health h WHERE h.user_id = u.id) AS score) ch)`
const ist = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

const SQL: Record<CustomerKey, FieldSql> = {
  status: {
    kind: 'enum',
    virtual: {
      active: 'u.is_active = true AND u.is_flagged = false',
      inactive: 'u.is_active = false AND u.is_flagged = false',
      flagged: 'u.is_flagged = true',
    },
  },
  segment: {
    kind: 'enum',
    virtual: {
      vip: stats('COALESCE(o.lifetime_value, 0) >= 50000'),
      loyal: stats('COALESCE(o.paid_orders, 0) >= 5 AND COALESCE(o.lifetime_value, 0) >= 25000'),
      repeat: stats('COALESCE(o.order_count, 0) >= 3'),
      one_time: stats('COALESCE(o.order_count, 0) = 1'),
      new: "u.created_at >= NOW() - INTERVAL '30 days'",
      at_risk: stats(
        "o.last_order_at IS NOT NULL AND o.last_order_at < NOW() - INTERVAL '90 days' AND o.last_order_at >= NOW() - INTERVAL '180 days'"
      ),
      dormant: stats("o.last_order_at IS NOT NULL AND o.last_order_at < NOW() - INTERVAL '180 days'"),
      b2b: 'EXISTS (SELECT 1 FROM customer_profiles cp WHERE cp.user_id = u.id AND (cp.gst_number IS NOT NULL OR cp.company_name IS NOT NULL))',
      lead: stats('COALESCE(o.order_count, 0) = 0'),
    },
  },
  health: {
    kind: 'enum',
    virtual: {
      healthy: health('ch.score >= 70'),
      at_risk: health('ch.score >= 40 AND ch.score < 70'),
      critical: health('ch.score IS NOT NULL AND ch.score < 40'),
      unknown: health('ch.score IS NULL'),
    },
  },
  tag: { kind: 'values', lateral: { from: 'customer_tags ct', link: 'ct.user_id = u.id', expr: 'ct.tag' } },

  joined: { kind: 'date', expr: 'u.created_at' },
  last_order: { kind: 'date', expr: userOrders('MAX(x.created_at)') },
  orders: { kind: 'range', expr: userOrders('COUNT(*)') },
  lifetime_value: { kind: 'range', expr: userOrders('COALESCE(SUM(x.total_amount), 0)') },

  user_type: { kind: 'enum', expr: 'u.user_type' },
  auth_provider: { kind: 'values', expr: "COALESCE(u.auth_provider, 'email')" },
  phone_verified: { kind: 'bool', expr: 'u.phone_verified' },
  marketing_opt_out: { kind: 'bool', expr: 'u.marketing_opt_out' },
}

export const CUSTOMERS_ENTITY: FilterEntity<CustomerKey> = {
  key: 'customers',
  scope: 'customers:read',
  exportScope: 'customers:write',
  noun: 'Customers',
  root: 'users',
  alias: 'u',
  base: ['u.is_guest = false'],
  fields: CUSTOMER_FIELDS,
  sql: SQL,
  period: 'joined',
  search: { build: (q, idx) => buildSearchClause(q, ['u.email', 'u.first_name', 'u.last_name', 'u.phone'], idx) },
  facets: true,
  export: {
    columns: [
      { key: 'name', label: 'Name', sql: "NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '')" },
      { key: 'email', label: 'Email', sql: 'u.email' },
      { key: 'phone', label: 'Phone', sql: 'u.phone' },
      { key: 'phone_verified', label: 'Phone verified', sql: 'u.phone_verified' },
      {
        key: 'status',
        label: 'Status',
        sql: "CASE WHEN u.is_flagged THEN 'flagged' WHEN u.is_active THEN 'active' ELSE 'inactive' END",
      },
      { key: 'account_type', label: 'Account type', sql: 'u.user_type' },
      { key: 'sign_in', label: 'Sign-in method', sql: 'u.auth_provider' },
      {
        key: 'company',
        label: 'Company',
        sql: `COALESCE((SELECT bp.company_name FROM business_profiles bp WHERE bp.user_id = u.id),
          (SELECT cp.company_name FROM customer_profiles cp WHERE cp.user_id = u.id))`,
      },
      {
        key: 'gstin',
        label: 'GSTIN',
        sql: `COALESCE((SELECT bp.gst_number FROM business_profiles bp WHERE bp.user_id = u.id),
          (SELECT cp.gst_number FROM customer_profiles cp WHERE cp.user_id = u.id))`,
      },
      { key: 'joined', label: 'Joined (IST)', sql: ist('u.created_at') },
      { key: 'orders', label: 'Orders', sql: userOrders('COUNT(*)') },
      { key: 'lifetime_value', label: 'Lifetime value', sql: userOrders('COALESCE(SUM(x.total_amount), 0)') },
      { key: 'last_order', label: 'Last order (IST)', sql: ist(userOrders('MAX(x.created_at)')) },
      { key: 'health', label: 'Health score', sql: '(SELECT h.score FROM customer_health h WHERE h.user_id = u.id)' },
      {
        key: 'tags',
        label: 'Tags',
        sql: "(SELECT string_agg(ct.tag, ', ' ORDER BY ct.tag) FROM customer_tags ct WHERE ct.user_id = u.id)",
      },
      { key: 'marketing_opt_out', label: 'Marketing opt-out', sql: 'u.marketing_opt_out' },
    ],
    keyset: ["COALESCE(u.created_at, '-infinity'::timestamptz)", 'u.id'],
  },
}
