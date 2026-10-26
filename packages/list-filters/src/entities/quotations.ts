import type { FieldKeys } from '../client'
import { buildVectorSearchClause } from '../search'
import type { FieldSql, FilterEntity } from '../types'
import { QUOTATION_ALIASES, QUOTATION_FIELDS, QUOTE_STALE_DRAFT_DAYS, QUOTE_VALID_DAYS } from './quotations.fields'

type QuotationKey = FieldKeys<typeof QUOTATION_FIELDS>

/** The total the list shows: the stored one, or the line sum for quotes saved before totals were stored. */
export const QUOTE_TOTAL_SQL = `(CASE WHEN COALESCE(q.total_amount, 0) = 0
  THEN COALESCE((SELECT SUM(qi.amount * (1 + qi.gst_rate / 100)) FROM quotation_items qi WHERE qi.quotation_id = q.id), 0)
  ELSE q.total_amount END)`
export const QUOTE_SUBTOTAL_SQL = `(CASE WHEN COALESCE(q.subtotal, 0) = 0
  THEN COALESCE((SELECT SUM(qi.amount) FROM quotation_items qi WHERE qi.quotation_id = q.id), 0)
  ELSE q.subtotal END)`
const BUYER = (col: string) => `(CASE WHEN q.buyer_same THEN q.consignee_${col} ELSE q.buyer_${col} END)`
const ADMIN_NAME = "COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)"
const AGE = `((now() AT TIME ZONE 'Asia/Kolkata')::date - q.quote_date)`
const OPEN = `q.status = 'final' AND q.converted_order_id IS NULL`

const SQL: Record<QuotationKey, FieldSql> = {
  status: { kind: 'enum', expr: 'q.status' },
  quoted: { kind: 'date', expr: 'q.quote_date', dateOnly: true },
  // Same windows as the overview's pipeline and its attention links.
  pipeline: {
    kind: 'enum',
    virtual: {
      open: `${OPEN} AND ${AGE} <= ${QUOTE_VALID_DAYS}`,
      expiring: `${OPEN} AND ${AGE} BETWEEN ${QUOTE_VALID_DAYS - 7} AND ${QUOTE_VALID_DAYS}`,
      lapsed: `${OPEN} AND ${AGE} > ${QUOTE_VALID_DAYS}`,
      stale_draft: `q.status = 'draft' AND q.created_at < now() - INTERVAL '${QUOTE_STALE_DRAFT_DAYS} days'`,
    },
  },
  converted: { kind: 'bool', expr: 'q.converted_order_id IS NOT NULL' },
  from_rfq: { kind: 'bool', expr: 'EXISTS (SELECT 1 FROM business_rfqs r WHERE r.converted_quotation_id = q.id)' },
  amount: { kind: 'range', expr: QUOTE_TOTAL_SQL },
  created_by: {
    kind: 'values',
    lateral: { from: 'admins a JOIN users u ON u.id = a.user_id', link: 'a.id = q.created_by', expr: ADMIN_NAME },
  },
  state: { kind: 'values', expr: BUYER('state') },
  city: { kind: 'values', expr: 'q.consignee_city' },
  gstin: { kind: 'bool', expr: `COALESCE(btrim(${BUYER('gstin')}), '') <> ''` },
}

export const QUOTATIONS_ENTITY: FilterEntity<QuotationKey> = {
  key: 'quotations',
  scope: 'quotations:read',
  noun: 'Quotations',
  root: 'quotations',
  alias: 'q',
  fields: QUOTATION_FIELDS,
  sql: SQL,
  period: 'quoted',
  aliases: QUOTATION_ALIASES,
  search: {
    build: (s, idx) =>
      buildVectorSearchClause(s, 'q.search_vector', ['q.consignee_name'], ['q.quote_number'], idx, 'simple'),
  },
  sorts: {
    quote_number: 'quote_number',
    quote_date: 'quote_date',
    consignee_name: 'consignee_name',
    total_amount: 'total_amount',
    status: 'status',
  },
  facets: true,
  export: {
    columns: [
      { key: 'quote_number', label: 'Quote no.', sql: 'q.quote_number' },
      { key: 'quote_date', label: 'Quote date', sql: 'q.quote_date::text' },
      { key: 'status', label: 'Status', sql: 'q.status' },
      { key: 'consignee', label: 'Consignee', sql: 'q.consignee_name' },
      { key: 'consignee_city', label: 'Consignee city', sql: 'q.consignee_city' },
      { key: 'consignee_state', label: 'Consignee state', sql: 'q.consignee_state' },
      { key: 'phone', label: 'Phone', sql: 'q.consignee_phone' },
      { key: 'email', label: 'Email', sql: 'q.consignee_email' },
      { key: 'buyer', label: 'Buyer', sql: `(CASE WHEN q.buyer_same THEN q.consignee_name ELSE q.buyer_name END)` },
      { key: 'buyer_state', label: 'Buyer state', sql: BUYER('state') },
      { key: 'buyer_gstin', label: 'Buyer GSTIN', sql: BUYER('gstin') },
      { key: 'subtotal', label: 'Subtotal ₹', sql: QUOTE_SUBTOTAL_SQL },
      { key: 'cgst', label: 'CGST ₹', sql: 'q.cgst_amount' },
      { key: 'sgst', label: 'SGST ₹', sql: 'q.sgst_amount' },
      { key: 'total', label: 'Total ₹', sql: QUOTE_TOTAL_SQL },
      {
        key: 'converted_order',
        label: 'Converted order',
        sql: '(SELECT o.order_number FROM orders o WHERE o.id = q.converted_order_id)',
      },
      {
        key: 'created_by',
        label: 'Created by',
        sql: `(SELECT ${ADMIN_NAME} FROM admins a JOIN users u ON u.id = a.user_id WHERE a.id = q.created_by)`,
      },
      {
        key: 'created_at',
        label: 'Created (IST)',
        sql: "to_char(q.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')",
      },
    ],
    keyset: ['q.quote_date', 'q.id'],
  },
}
