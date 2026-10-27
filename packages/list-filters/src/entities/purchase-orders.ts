import type { FieldKeys } from '../client'
import { defineFields } from '../client'
import { buildSearchClause } from '../search'
import type { FieldSql, FilterEntity } from '../types'
import { PO_ALIASES, PO_FIELDS } from './purchase-orders.fields'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Old API param: the list took ?supplier_id=<uuid>. Kept off the panel (the Supplier field filters by name).
const LEGACY_FIELDS = defineFields({ supplier_id: { label: 'Supplier', type: 'text' } })
const FIELDS = [...PO_FIELDS, ...LEGACY_FIELDS]

type PoKey = FieldKeys<typeof FIELDS>

export const PO_SUPPLIER_NAME_SQL = '(SELECT s.name FROM suppliers s WHERE s.id = po.supplier_id)'
export const PO_OPEN_SQL = "po.status IN ('draft', 'sent', 'partial')"
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`

const SQL: Record<PoKey, FieldSql> = {
  status: { kind: 'enum', expr: 'po.status' },
  supplier: { kind: 'values', expr: PO_SUPPLIER_NAME_SQL },
  ordered: { kind: 'date', expr: 'po.order_date', dateOnly: true },
  expected: { kind: 'date', expr: 'po.expected_date', dateOnly: true },
  amount: { kind: 'range', expr: 'po.total_amount' },
  // Same rule as the overview's days late.
  overdue: { kind: 'flag', expr: `po.status IN ('sent', 'partial') AND po.expected_date < ${TODAY}` },
  has_receipts: { kind: 'bool', expr: 'EXISTS (SELECT 1 FROM grns g WHERE g.po_id = po.id)' },
  supplier_id: {
    kind: 'custom',
    build: (q, bind) => (UUID_RE.test(q.supplier_id ?? '') ? `po.supplier_id = ${bind(q.supplier_id)}::uuid` : null),
  },
}

export const PURCHASE_ORDERS_ENTITY: FilterEntity<PoKey> = {
  key: 'purchase-orders',
  scope: 'inventory:read',
  noun: 'Purchase orders',
  root: 'purchase_orders',
  alias: 'po',
  fields: FIELDS,
  sql: SQL,
  period: 'ordered',
  aliases: PO_ALIASES,
  search: { build: (s, idx) => buildSearchClause(s, ['po.po_number', PO_SUPPLIER_NAME_SQL], idx) },
  sorts: {
    po_number: 'po.po_number',
    supplier: PO_SUPPLIER_NAME_SQL,
    date: 'po.order_date',
    expected: 'po.expected_date',
    items: '(SELECT COUNT(*) FROM purchase_order_items x WHERE x.po_id = po.id)',
    total: 'po.total_amount',
    status: 'po.status',
  },
  defaultSql: 'po.created_at DESC',
  tiebreak: 'po.id DESC',
  facets: true,
  export: {
    columns: [
      { key: 'po_number', label: 'PO no.', sql: 'po.po_number' },
      { key: 'supplier', label: 'Supplier', sql: PO_SUPPLIER_NAME_SQL },
      { key: 'status', label: 'Status', sql: 'po.status' },
      { key: 'order_date', label: 'Order date', sql: 'po.order_date::text' },
      { key: 'expected_date', label: 'Expected', sql: 'po.expected_date::text' },
      {
        key: 'items',
        label: 'Lines',
        sql: '(SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.po_id = po.id)',
      },
      { key: 'subtotal', label: 'Subtotal ₹', sql: 'po.subtotal' },
      { key: 'tax', label: 'Tax ₹', sql: 'po.tax_amount' },
      { key: 'total', label: 'Total ₹', sql: 'po.total_amount' },
      {
        key: 'last_received',
        label: 'Last received',
        sql: '(SELECT MAX(g.received_date)::text FROM grns g WHERE g.po_id = po.id)',
      },
      { key: 'notes', label: 'Notes', sql: 'po.notes' },
    ],
    keyset: ['po.order_date', 'po.id'],
  },
}
