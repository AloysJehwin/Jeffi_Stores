import type { FieldKeys } from '../client'
import { unionEntity } from '../clauses'
import { buildVectorSearchClause } from '../search'
import type { FieldSql, FilterBranch } from '../types'
import { INVOICE_ALIASES, INVOICE_FIELDS } from './invoices.fields'

// Invoices = numbered orders (not cash_sale-sourced) plus numbered cash sales. Each field has SQL per
// branch; a constant (`false`, NULL) leaves cash sales out when an order-only filter is set.

type InvoiceKey = FieldKeys<typeof INVOICE_FIELDS>

const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
/** Unpaid on a still-live document, invoice dated over 30 days ago (the overview's overdue receivable). */
const overdue = (a: string) =>
  `${a}.payment_status IN ('unpaid', 'partial') AND ${a}.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
    AND (${a}.invoice_date AT TIME ZONE 'Asia/Kolkata')::date < ${TODAY} - 30`

const ORDER_SQL: Record<InvoiceKey, FieldSql> = {
  source: { kind: 'enum', expr: 'o.source' },
  payment_status: { kind: 'enum', expr: 'o.payment_status' },
  invoiced: { kind: 'date', expr: 'o.invoice_date' },
  voided: { kind: 'bool', expr: "o.status = 'cancelled'" },
  overdue: { kind: 'flag', expr: overdue('o') },
  amount: { kind: 'range', expr: 'o.total_amount' },
  tax: {
    kind: 'range',
    expr: '(COALESCE(o.cgst_amount, 0) + COALESCE(o.sgst_amount, 0) + COALESCE(o.igst_amount, 0))',
  },
  irn_status: { kind: 'values', expr: "COALESCE(o.irn_status, 'pending')" },
  b2b: { kind: 'bool', expr: "COALESCE(btrim(o.buyer_gstin), '') <> ''" },
  igst: { kind: 'bool', expr: 'COALESCE(o.is_igst, false)' },
  eway: { kind: 'bool', expr: 'o.eway_bill_no IS NOT NULL' },
  has_pdf: {
    kind: 'bool',
    expr: 'EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.pdf_url IS NOT NULL)',
  },
}

const CASH_SQL: Record<InvoiceKey, FieldSql> = {
  source: { kind: 'enum', expr: "'cash_sale'::text" },
  payment_status: { kind: 'enum', expr: 'cs.payment_status' },
  invoiced: { kind: 'date', expr: 'cs.invoice_date' },
  voided: { kind: 'bool', expr: "cs.status = 'cancelled'" },
  overdue: { kind: 'flag', expr: overdue('cs') },
  amount: { kind: 'range', expr: 'cs.total_amount' },
  tax: { kind: 'range', expr: '(cs.cgst_amount + cs.sgst_amount + cs.igst_amount)' },
  irn_status: { kind: 'values', expr: 'NULL::text' },
  b2b: { kind: 'bool', expr: 'false' },
  igst: { kind: 'bool', expr: 'cs.is_igst' },
  eway: { kind: 'bool', expr: 'false' },
  has_pdf: {
    kind: 'bool',
    expr: 'EXISTS (SELECT 1 FROM invoices i WHERE i.sale_id = cs.id AND i.pdf_url IS NOT NULL)',
  },
}

const IST_DAY = (c: string) => `to_char(${c} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`
// Keyset on milliseconds: the batch cursor comes back as a JS Date, which drops microseconds.
const KEY_AT = (c: string) => `date_trunc('milliseconds', COALESCE(${c}, '-infinity'::timestamptz))`

export const INVOICE_BRANCHES: [FilterBranch<InvoiceKey>, FilterBranch<InvoiceKey>] = [
  {
    key: 'order',
    root: 'orders',
    alias: 'o',
    base: ['o.invoice_number IS NOT NULL', "o.source != 'cash_sale'"],
    sql: ORDER_SQL,
    search: (q, idx) =>
      buildVectorSearchClause(
        q,
        'o.search_vector',
        ['o.customer_name'],
        ['o.invoice_number', 'o.order_number'],
        idx,
        'simple'
      ),
    export: {
      columns: {
        invoice_number: 'o.invoice_number',
        invoice_date: IST_DAY('o.invoice_date'),
        source: 'o.source',
        document: 'o.order_number',
        customer: 'o.customer_name',
        phone: 'o.customer_phone',
        email: 'o.customer_email',
        gstin: 'o.buyer_gstin',
        taxable: 'o.taxable_amount',
        cgst: 'o.cgst_amount',
        sgst: 'o.sgst_amount',
        igst: 'o.igst_amount',
        total: 'o.total_amount',
        payment_status: 'o.payment_status',
        status: 'o.status',
        irn_status: 'o.irn_status',
        irn: 'o.irn',
        eway_bill: 'o.eway_bill_no',
      },
      keyset: [KEY_AT('o.invoice_date'), 'o.id'],
    },
  },
  {
    key: 'cash_sale',
    root: 'cash_sales',
    alias: 'cs',
    base: ['cs.invoice_number IS NOT NULL'],
    sql: CASH_SQL,
    search: (q, idx) =>
      buildVectorSearchClause(
        q,
        'cs.search_vector',
        ['cs.customer_name'],
        ['cs.invoice_number', 'cs.sale_number'],
        idx,
        'simple'
      ),
    export: {
      columns: {
        invoice_number: 'cs.invoice_number',
        invoice_date: IST_DAY('cs.invoice_date'),
        source: "'cash_sale'",
        document: 'cs.sale_number',
        customer: 'cs.customer_name',
        phone: 'cs.customer_phone',
        taxable: 'cs.taxable_amount',
        cgst: 'cs.cgst_amount',
        sgst: 'cs.sgst_amount',
        igst: 'cs.igst_amount',
        total: 'cs.total_amount',
        payment_status: 'cs.payment_status',
        status: 'cs.status',
      },
      keyset: [KEY_AT('cs.invoice_date'), 'cs.id'],
    },
  },
]

export const INVOICE_SORTS: Record<string, string> = {
  invoice_number: 'invoice_number',
  invoice_date: 'invoice_date',
  customer_name: 'customer_name',
  total_amount: 'total_amount',
  payment_status: 'payment_status',
  source: 'source',
}

export const INVOICES_ENTITY = unionEntity<InvoiceKey>({
  key: 'invoices',
  scope: 'invoices:read',
  noun: 'Invoices',
  fields: INVOICE_FIELDS,
  period: 'invoiced',
  aliases: INVOICE_ALIASES,
  search: {},
  sorts: INVOICE_SORTS,
  facets: true,
  branches: INVOICE_BRANCHES,
  export: {
    columns: [
      { key: 'invoice_number', label: 'Invoice no.', sql: 'NULL' },
      { key: 'invoice_date', label: 'Invoice date', sql: 'NULL' },
      { key: 'source', label: 'Source', sql: 'NULL' },
      { key: 'document', label: 'Order / sale no.', sql: 'NULL' },
      { key: 'customer', label: 'Customer', sql: 'NULL' },
      { key: 'phone', label: 'Phone', sql: 'NULL' },
      { key: 'email', label: 'Email', sql: 'NULL' },
      { key: 'gstin', label: 'Buyer GSTIN', sql: 'NULL' },
      { key: 'taxable', label: 'Taxable ₹', sql: 'NULL' },
      { key: 'cgst', label: 'CGST ₹', sql: 'NULL' },
      { key: 'sgst', label: 'SGST ₹', sql: 'NULL' },
      { key: 'igst', label: 'IGST ₹', sql: 'NULL' },
      { key: 'total', label: 'Total ₹', sql: 'NULL' },
      { key: 'payment_status', label: 'Payment', sql: 'NULL' },
      { key: 'status', label: 'Status', sql: 'NULL' },
      { key: 'irn_status', label: 'IRN status', sql: 'NULL' },
      { key: 'irn', label: 'IRN', sql: 'NULL' },
      { key: 'eway_bill', label: 'E-way bill', sql: 'NULL' },
    ],
    keyset: ['invoice_date', 'id'],
  },
})
