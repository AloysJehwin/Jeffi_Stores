import { escapeLike, type ExportColumn, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { REPLACEMENT_FIELDS, RETURN_FIELDS } from '../fields/returns'

// return_requests rows of one type (refund = Returns, replacement = Replacements).

type RequestKey = FieldKeys<typeof RETURN_FIELDS>

const ITEMS = (agg: string) => `(SELECT COALESCE(SUM(i.${agg}), 0) FROM return_request_items i WHERE i.return_request_id = rr.id)`
const ORDER = (col: string) => `(SELECT o.${col} FROM orders o WHERE o.id = rr.order_id)`
const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

const SQL: Record<RequestKey, FieldSql> = {
  reason: { kind: 'enum', expr: 'rr.reason' },
  status: { kind: 'enum', expr: 'rr.status' },
  created: { kind: 'date', expr: 'rr.created_at' },
  amount: { kind: 'range', expr: ITEMS('refund_amount') },
  has_images: { kind: 'bool', expr: 'COALESCE(cardinality(rr.image_urls), 0) > 0' },
  valuation: {
    kind: 'enum',
    expr: 'rr.valuation_condition',
    virtual: { pending: "rr.valuation_status IS DISTINCT FROM 'approved'" },
  },
  pickup: { kind: 'bool', expr: 'rr.rvp_awb_number IS NOT NULL' },
  source: { kind: 'enum', expr: 'o.source', exists: { from: 'orders o', link: 'o.id = rr.order_id' } },
}

const COLUMNS: ExportColumn[] = [
  { key: 'order_number', label: 'Order no', sql: ORDER('order_number') },
  { key: 'raised_at', label: 'Raised on', sql: IST('rr.created_at') },
  { key: 'status', label: 'Status', sql: 'rr.status' },
  { key: 'reason', label: 'Reason', sql: 'rr.reason' },
  { key: 'customer', label: 'Customer', sql: ORDER('customer_name') },
  { key: 'units', label: 'Units', sql: ITEMS('quantity') },
  { key: 'amount', label: 'Amount', sql: ITEMS('refund_amount') },
  { key: 'pickup_awb', label: 'Pickup AWB', sql: 'rr.rvp_awb_number' },
  { key: 'received_at', label: 'Received on', sql: IST('rr.received_at') },
  { key: 'condition', label: 'Inspection', sql: 'rr.valuation_condition' },
  { key: 'resolved_at', label: 'Closed on', sql: IST('rr.resolved_at') },
]

function requestEntity(type: 'refund' | 'replacement'): FilterEntity<RequestKey> {
  const refund = type === 'refund'
  return {
    key: refund ? 'returns' : 'replacements',
    scope: refund ? 'returns:read' : 'replacements:read',
    noun: refund ? 'Returns' : 'Replacements',
    root: 'return_requests',
    alias: 'rr',
    base: [`rr.type = '${type}'`, 'rr.order_id IS NOT NULL'],
    fields: refund ? RETURN_FIELDS : REPLACEMENT_FIELDS,
    sql: SQL,
    period: 'created',
    // Order number or customer name / email, escaped contains.
    search: {
      build: (q, idx) => ({
        clause: `EXISTS (SELECT 1 FROM orders o WHERE o.id = rr.order_id
          AND (o.order_number ILIKE $${idx} OR o.customer_name ILIKE $${idx} OR o.customer_email ILIKE $${idx}))`,
        params: [`%${escapeLike(q.trim())}%`],
        nextIdx: idx + 1,
      }),
    },
    facets: true,
    export: {
      columns: refund
        ? COLUMNS
        : [
            ...COLUMNS,
            {
              key: 'replacement_order',
              label: 'Replacement order',
              sql: '(SELECT o.order_number FROM orders o WHERE o.id = rr.replacement_order_id)',
            },
          ],
      keyset: ['rr.created_at', 'rr.id'],
    },
  }
}

export const RETURNS_ENTITY = requestEntity('refund')
export const REPLACEMENTS_ENTITY = requestEntity('replacement')
