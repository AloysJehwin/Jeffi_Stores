import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
// The cash-sale list route's tests mock this module's search builder.
import { buildVectorSearchClause } from '@/lib/catalog/search'
import { CASH_SALE_ALIASES, CASH_SALE_FIELDS } from '../fields/cash-sale'

type CashSaleKey = FieldKeys<typeof CASH_SALE_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

const SQL: Record<CashSaleKey, FieldSql> = {
  payment_status: { kind: 'enum', expr: 'cs.payment_status' },
  payment_mode: { kind: 'enum', expr: 'cs.payment_mode' },
  status: { kind: 'enum', expr: 'cs.status' },
  invoice: { kind: 'date', expr: 'cs.invoice_date' },
  amount: { kind: 'range', expr: 'cs.total_amount' },
  igst: { kind: 'bool', expr: 'cs.is_igst IS TRUE' },
  customer: { kind: 'text', expr: ['cs.customer_name', 'cs.customer_phone'] },
}

export const CASH_SALE_SORTS: Record<string, string> = {
  invoice_number: 'cs.invoice_number',
  invoice_date: 'cs.invoice_date',
  customer_name: 'cs.customer_name',
  total_amount: 'cs.total_amount',
  payment_status: 'cs.payment_status',
}

export const CASH_SALE_ENTITY: FilterEntity<CashSaleKey> = {
  key: 'cash_sale',
  scope: 'invoices:read',
  noun: 'Cash sales',
  root: 'cash_sales',
  alias: 'cs',
  fields: CASH_SALE_FIELDS,
  sql: SQL,
  period: 'invoice',
  aliases: CASH_SALE_ALIASES,
  search: {
    build: (q, idx) =>
      buildVectorSearchClause(q, 'cs.search_vector', ['cs.customer_name'], ['cs.invoice_number', 'cs.sale_number'], idx, 'simple'),
  },
  sorts: CASH_SALE_SORTS,
  facets: true,
  export: {
    columns: [
      { key: 'sale_number', label: 'Sale no', sql: 'cs.sale_number' },
      { key: 'invoice_number', label: 'Receipt no', sql: 'cs.invoice_number' },
      { key: 'invoice_date', label: 'Bill date', sql: IST('cs.invoice_date') },
      { key: 'customer', label: 'Customer', sql: 'cs.customer_name' },
      { key: 'phone', label: 'Phone', sql: 'cs.customer_phone' },
      { key: 'payment_mode', label: 'Payment mode', sql: 'cs.payment_mode' },
      { key: 'payment_status', label: 'Payment', sql: 'cs.payment_status' },
      { key: 'status', label: 'Status', sql: 'cs.status' },
      { key: 'taxable', label: 'Taxable', sql: 'cs.taxable_amount' },
      { key: 'cgst', label: 'CGST', sql: 'cs.cgst_amount' },
      { key: 'sgst', label: 'SGST', sql: 'cs.sgst_amount' },
      { key: 'igst', label: 'IGST', sql: 'cs.igst_amount' },
      { key: 'total', label: 'Total', sql: 'cs.total_amount' },
    ],
    keyset: ['cs.created_at', 'cs.id'],
  },
}
