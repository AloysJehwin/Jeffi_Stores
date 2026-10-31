import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { buildSearchClause } from '@/lib/catalog/search'
import { PAYABLES } from '@/lib/overviews/suppliers'
import { SUPPLIER_FIELDS } from '../fields/suppliers'
import { col, ist, nullableTs, yesNo } from './shared'

type SupplierKey = FieldKeys<typeof SUPPLIER_FIELDS>

const PO_COUNT = '(SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id)'
const OPEN_POS = `EXISTS (SELECT 1 FROM purchase_orders po WHERE po.supplier_id = s.id
  AND COALESCE(po.status, '') NOT IN ('received', 'cancelled', 'closed', 'completed'))`
// Open bills, as the Suppliers overview counts them.
export const SUPPLIER_PAYABLE_SQL = `(SELECT COALESCE(SUM(x.amount), 0) FROM (${PAYABLES}) x WHERE x.supplier_id = s.id AND x.amount > 0)`

const SQL: Record<SupplierKey, FieldSql> = {
  active: { kind: 'bool', expr: 'COALESCE(s.is_active, false)' },
  has_gstin: { kind: 'bool', expr: "COALESCE(btrim(s.gstin), '') <> ''" },
  payment_terms: { kind: 'values', expr: 's.payment_terms::text' },
  pos: { kind: 'range', expr: PO_COUNT },
  open_pos: { kind: 'flag', expr: OPEN_POS },
  payable: { kind: 'range', expr: SUPPLIER_PAYABLE_SQL },
  created: { kind: 'date', expr: 's.created_at' },
}

export const SUPPLIER_SORTS: Record<string, string> = {
  name: 's.name',
  gstin: 's.gstin',
  contact: 's.contact_name',
  phone: 's.phone',
  terms: 's.payment_terms',
  pos: PO_COUNT,
  status: 's.is_active',
}

export const SUPPLIERS_ENTITY: FilterEntity<SupplierKey> = {
  key: 'suppliers',
  scope: 'inventory:read',
  noun: 'Suppliers',
  root: 'suppliers',
  alias: 's',
  fields: SUPPLIER_FIELDS,
  sql: SQL,
  period: 'created',
  search: { build: (q, idx) => buildSearchClause(q, ['s.name', 's.gstin', 's.contact_name'], idx) },
  sorts: SUPPLIER_SORTS,
  defaultSql: 's.name',
  tiebreak: 's.id',
  facets: true,
  export: {
    columns: [
      col('name', 'Supplier', 's.name'),
      col('gstin', 'GSTIN', 's.gstin'),
      col('contact', 'Contact', 's.contact_name'),
      col('phone', 'Phone', 's.phone'),
      col('email', 'Email', 's.email'),
      col('address', 'Address', 's.address'),
      col('terms', 'Payment terms (days)', 's.payment_terms'),
      col('status', 'Status', "CASE WHEN s.is_active THEN 'Active' ELSE 'Inactive' END"),
      col('pos', 'Purchase orders', PO_COUNT),
      col('open_pos', 'Has open POs', yesNo(OPEN_POS)),
      col('payable', 'Payable', SUPPLIER_PAYABLE_SQL),
      col('created', 'Added on', ist('s.created_at')),
    ],
    keyset: [nullableTs('s.created_at'), 's.id'],
  },
}
