import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { B2B_ALIASES, B2B_FIELDS } from '../fields/business-customers'

// B2B accounts (business_profiles bp, one per user); orders and lifetime value count the user's
// live orders.

type B2bKey = FieldKeys<typeof B2B_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`
const LIVE_ORDERS = `FROM orders o WHERE o.user_id = bp.user_id AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')`
export const B2B_ORDERS_SQL = `(SELECT COUNT(*) ${LIVE_ORDERS})`
export const B2B_LTV_SQL = `(SELECT COALESCE(SUM(o.total_amount), 0) ${LIVE_ORDERS})`
const USER = (col: string) => `(SELECT u.${col} FROM users u WHERE u.id = bp.user_id)`

const SQL: Record<B2bKey, FieldSql> = {
  approval: { kind: 'enum', expr: 'bp.approval_status' },
  created: { kind: 'date', expr: 'bp.created_at' },
  industry: { kind: 'values', expr: 'bp.industry' },
  gstin: { kind: 'bool', expr: "NULLIF(btrim(bp.gst_number), '') IS NOT NULL" },
  state: { kind: 'values', lateral: { from: 'addresses a', link: 'a.user_id = bp.user_id', expr: 'a.state' } },
  orders: { kind: 'range', expr: B2B_ORDERS_SQL },
  ltv: { kind: 'range', expr: B2B_LTV_SQL },
}

export const B2B_ENTITY: FilterEntity<B2bKey> = {
  key: 'business_customers',
  scope: 'business_customers:read',
  // Emails, phones and GSTINs.
  exportScope: 'business_customers:write',
  noun: 'Accounts',
  root: 'business_profiles',
  alias: 'bp',
  // Overviews scope B2B orders by the account's user.
  pk: 'user_id',
  fields: B2B_FIELDS,
  sql: SQL,
  period: 'created',
  aliases: B2B_ALIASES,
  // Email, company or GSTIN; escaped contains.
  search: {
    build: (q, idx) => ({
      clause: `(bp.company_name ILIKE $${idx} OR bp.gst_number ILIKE $${idx}
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = bp.user_id AND u.email ILIKE $${idx}))`,
      params: [`%${escapeLike(q.trim())}%`],
      nextIdx: idx + 1,
    }),
  },
  facets: true,
  export: {
    columns: [
      { key: 'company', label: 'Company', sql: 'bp.company_name' },
      { key: 'gstin', label: 'GSTIN', sql: 'bp.gst_number' },
      { key: 'industry', label: 'Industry', sql: 'bp.industry' },
      { key: 'approval', label: 'Approval', sql: 'bp.approval_status' },
      { key: 'contact', label: 'Contact', sql: `btrim(concat_ws(' ', ${USER('first_name')}, ${USER('last_name')}))` },
      { key: 'email', label: 'Email', sql: USER('email') },
      { key: 'phone', label: 'Phone', sql: USER('phone') },
      { key: 'address', label: 'Business address', sql: 'bp.business_address' },
      { key: 'orders', label: 'Orders', sql: B2B_ORDERS_SQL },
      { key: 'ltv', label: 'Lifetime value', sql: B2B_LTV_SQL },
      { key: 'applied_at', label: 'Applied on', sql: IST('bp.created_at') },
      { key: 'approved_at', label: 'Approved on', sql: IST('bp.approved_at') },
    ],
    keyset: ['bp.created_at', 'bp.id'],
  },
}
