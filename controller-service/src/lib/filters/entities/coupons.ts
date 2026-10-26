import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { COUPON_ALIASES, COUPON_FIELDS } from '../fields/coupons'

type CouponKey = FieldKeys<typeof COUPON_FIELDS>

const EXHAUSTED = 'c.usage_limit IS NOT NULL AND COALESCE(c.times_used, 0) >= c.usage_limit'
const ist = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

const SQL: Record<CouponKey, FieldSql> = {
  is_active: { kind: 'bool', expr: 'COALESCE(c.is_active, false)' },
  state: {
    kind: 'enum',
    virtual: {
      live: `COALESCE(c.is_active, false) AND (c.valid_from IS NULL OR c.valid_from <= NOW())
        AND (c.valid_until IS NULL OR c.valid_until > NOW()) AND NOT (${EXHAUSTED})`,
      scheduled: 'c.valid_from > NOW()',
      expired: 'c.valid_until <= NOW()',
      exhausted: EXHAUSTED,
    },
  },
  auto_generated: { kind: 'bool', expr: 'c.auto_generated' },
  campaign: { kind: 'values', expr: 'c.generated_for_campaign' },

  discount_type: { kind: 'enum', expr: 'c.discount_type' },
  value: { kind: 'range', expr: 'c.discount_value' },
  min_purchase: { kind: 'range', expr: 'COALESCE(c.min_purchase_amount, 0)' },
  used: { kind: 'range', expr: 'COALESCE(c.times_used, 0)' },

  created: { kind: 'date', expr: 'c.created_at' },
  starts: { kind: 'date', expr: 'c.valid_from' },
  ends: { kind: 'date', expr: 'c.valid_until' },
}

export const COUPON_SORTS: Record<string, string> = {
  code: 'c.code',
  type: 'c.discount_type',
  value: 'c.discount_value',
  min_purchase: 'c.min_purchase_amount',
  usage: 'c.times_used',
  valid_until: 'c.valid_until',
  status: 'c.is_active',
}

export const COUPONS_ENTITY: FilterEntity<CouponKey> = {
  key: 'coupons',
  scope: 'coupons:read',
  noun: 'Coupons',
  root: 'coupons',
  alias: 'c',
  // Never-published drafts live only in the Drafts section.
  base: ['c.is_draft = false'],
  fields: COUPON_FIELDS,
  sql: SQL,
  period: 'created',
  aliases: COUPON_ALIASES,
  search: {
    build: (q, idx) => ({
      clause: `(c.code ILIKE $${idx} OR c.description ILIKE $${idx})`,
      params: [`%${escapeLike(q)}%`],
      nextIdx: idx + 1,
    }),
  },
  sorts: COUPON_SORTS,
  facets: true,
  export: {
    columns: [
      { key: 'code', label: 'Code', sql: 'c.code' },
      { key: 'description', label: 'Description', sql: 'c.description' },
      { key: 'discount_type', label: 'Discount type', sql: 'c.discount_type' },
      { key: 'discount_value', label: 'Discount value', sql: 'c.discount_value' },
      { key: 'max_discount', label: 'Maximum discount', sql: 'c.max_discount_amount' },
      { key: 'min_purchase', label: 'Minimum purchase', sql: 'c.min_purchase_amount' },
      { key: 'usage_limit', label: 'Usage limit', sql: 'c.usage_limit' },
      { key: 'per_user_limit', label: 'Per-customer limit', sql: 'c.usage_limit_per_user' },
      { key: 'times_used', label: 'Times used', sql: 'COALESCE(c.times_used, 0)' },
      { key: 'valid_from', label: 'Valid from (IST)', sql: ist('c.valid_from') },
      { key: 'valid_until', label: 'Valid until (IST)', sql: ist('c.valid_until') },
      { key: 'active', label: 'Active', sql: 'COALESCE(c.is_active, false)' },
      { key: 'auto_generated', label: 'Auto-generated', sql: 'c.auto_generated' },
      { key: 'campaign', label: 'Campaign', sql: 'c.generated_for_campaign' },
      { key: 'created', label: 'Created (IST)', sql: ist('c.created_at') },
    ],
    keyset: ["COALESCE(c.created_at, '-infinity'::timestamptz)", 'c.id'],
  },
}
