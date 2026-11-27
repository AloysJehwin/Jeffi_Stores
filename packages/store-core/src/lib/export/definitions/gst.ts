import 'server-only'
import { buildHsnSummary, bySource, getGstr1, getGstr3b, gstSourceLabel, invoicedSources, itcSummary, loadItcRows, summarizeGstr1, type GstInvoice } from '@/lib/gst/returns'
import { defineExport, type ExportDefinition, type ExportRunContext, type ExportSection } from '../define'
import { narrowed, type DateRange, type ExportColumn, type ExportFilter } from '../types'

// GST compliance exports. Each calls the same function as the GST page's API with the same period
// and revenue sources, so the exported totals are the page's totals; unticking a source (e.g. cash
// sales) recomputes every table and total without it.

const SCOPE = 'gst:read'

function monthToDate(): Required<DateRange> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return { from: `${today.slice(0, 8)}01`, to: today }
}

const period = (ctx: ExportRunContext): Required<DateRange> => {
  const d = monthToDate()
  return { from: ctx.range.from ?? d.from, to: ctx.range.to ?? ctx.range.from ?? d.to }
}

function rangeFromQuery(q: URLSearchParams): DateRange | undefined {
  const from = q.get('from') ?? undefined
  const to = q.get('to') ?? undefined
  return from || to ? { from, to } : undefined
}

async function sourcesFilter(): Promise<ExportFilter> {
  const sources = await invoicedSources().catch(() => [] as string[])
  const opts = (sources.length ? sources : ['online', 'offline', 'business', 'cash_sale']).map(s => ({ value: s, label: gstSourceLabel(s) }))
  return { key: 'sources', label: 'Revenue sources', kind: 'multi', options: opts, help: 'Untick a source to leave its invoices out; every table and total is recomputed.' }
}

/** Sources ticked in the dialog (null = all of them). */
async function pickedSources(ctx: ExportRunContext): Promise<string[] | null> {
  return narrowed(await sourcesFilter(), ctx.filters)
}

const filename = (base: string) => (ctx: ExportRunContext) => {
  const p = period(ctx)
  return `${base}_${p.from}_to_${p.to}`
}

const money = (key: string, label: string, total = true): ExportColumn => ({ key, label, type: 'money', total: total ? 'sum' : undefined })

const INVOICE_COLS: ExportColumn[] = [
  { key: 'invoice_number', label: 'Invoice No', id: true, width: 1.3 },
  { key: 'invoice_date', label: 'Invoice Date', type: 'date', id: true },
  { key: 'buyer_gstin', label: 'Buyer GSTIN', id: true, width: 1.4 },
  { key: 'customer_name', label: 'Customer', width: 1.5 },
  { key: 'buyer_state', label: 'Place of supply' },
  { key: 'type', label: 'Invoice type' },
  { key: 'source', label: 'Revenue source' },
  { key: 'supply', label: 'Supply', optional: true },
  money('taxable_amount', 'Taxable Value'),
  money('cgst_amount', 'CGST'),
  money('sgst_amount', 'SGST'),
  money('igst_amount', 'IGST'),
  money('total_tax', 'Total Tax'),
  money('total_amount', 'Invoice Value'),
  { key: 'order_number', label: 'Order / sale no', optional: true },
  { key: 'irn', label: 'IRN', optional: true, width: 2 },
  { key: 'irn_ack_no', label: 'IRN Ack No', optional: true },
]

const invoiceRow = (r: GstInvoice) => ({
  ...r,
  type: r.buyer_gstin ? 'B2B' : 'B2C',
  source: gstSourceLabel(r.source ?? 'online'),
  supply: r.is_igst ? 'Inter-State' : 'Intra-State',
  total_tax: (parseFloat(String(r.cgst_amount || 0)) + parseFloat(String(r.sgst_amount || 0)) + parseFloat(String(r.igst_amount || 0))).toFixed(2),
})

const HSN_COLS: ExportColumn[] = [
  { key: 'hsnCode', label: 'HSN Code', id: true },
  { key: 'gstRate', label: 'GST Rate', type: 'percent' },
  { key: 'uqc', label: 'UQC' },
  { key: 'qty', label: 'Quantity', type: 'number', total: 'sum' },
  money('taxableVal', 'Taxable Value'),
  money('cgstAmt', 'CGST'),
  money('sgstAmt', 'SGST'),
  money('igstAmt', 'IGST'),
  money('totalTax', 'Total Tax'),
]

const SOURCE_COLS: ExportColumn[] = [
  { key: 'label', label: 'Revenue source', id: true },
  { key: 'invoices', label: 'Invoices', type: 'int', total: 'sum' },
  money('taxable', 'Taxable Value'),
  money('tax', 'Tax'),
  money('total', 'Invoice Value'),
]

const GSTR1_SECTIONS: ExportFilter = {
  key: 'sections',
  label: 'Tables',
  kind: 'multi',
  options: [
    { value: 'b2b', label: 'B2B invoices' },
    { value: 'b2c', label: 'B2C invoices' },
    { value: 'hsn', label: 'HSN summary' },
    { value: 'sources', label: 'Revenue by source' },
  ],
}

const wants = (ctx: ExportRunContext, f: ExportFilter, v: string) => {
  const picked = narrowed(f, ctx.filters)
  return !picked || picked.includes(v)
}

export const GSTR1_EXPORT = defineExport({
  key: 'gst.gstr1',
  title: 'GSTR-1',
  noun: 'Invoices',
  scope: SCOPE,
  columns: INVOICE_COLS,
  filters: async () => [await sourcesFilter(), GSTR1_SECTIONS],
  scopes: ['filtered'],
  dateRange: { label: 'Return period' },
  rangeFromQuery,
  filename: filename('GSTR1'),
  count: async ctx => {
    const p = period(ctx)
    return (await getGstr1(p.from, p.to, await pickedSources(ctx))).summary.totalInvoices
  },
  sections: async ctx => {
    const p = period(ctx)
    const r = await getGstr1(p.from, p.to, await pickedSources(ctx))
    const rows = [...r.b2b, ...r.b2c]
    const s = summarizeGstr1(rows)
    const out: ExportSection[] = []
    if (wants(ctx, GSTR1_SECTIONS, 'b2b')) out.push({ key: 'b2b', title: `B2B Invoices (${r.b2b.length})`, rows: r.b2b.map(invoiceRow) })
    if (wants(ctx, GSTR1_SECTIONS, 'b2c')) out.push({ key: 'b2c', title: `B2C Invoices (${r.b2c.length})`, rows: r.b2c.map(invoiceRow) })
    if (wants(ctx, GSTR1_SECTIONS, 'hsn')) out.push({ key: 'hsn', title: 'HSN Summary', columns: HSN_COLS, rows: buildHsnSummary(rows) })
    if (wants(ctx, GSTR1_SECTIONS, 'sources')) out.push({ key: 'sources', title: 'Revenue by Source', columns: SOURCE_COLS, rows: bySource(rows) })
    if (!out.length) out.push({ key: 'none', title: 'GSTR-1', rows: [], totals: null })
    out[out.length - 1].summary = [
      { label: 'Invoices', value: s.totalInvoices, type: 'int' },
      { label: 'B2B invoices', value: s.b2bCount, type: 'int' },
      { label: 'B2C invoices', value: s.b2cCount, type: 'int' },
      { label: 'Taxable value', value: s.totalTaxable, type: 'money' },
      { label: 'CGST', value: s.totalCgst, type: 'money' },
      { label: 'SGST', value: s.totalSgst, type: 'money' },
      { label: 'IGST', value: s.totalIgst, type: 'money' },
      { label: 'Total tax', value: s.totalTax, type: 'money' },
      { label: 'Invoice value', value: s.totalInvoiceValue, type: 'money' },
    ]
    return out
  },
})

const RATE_COLS: ExportColumn[] = [
  { key: 'gstRate', label: 'GST Rate', type: 'percent', id: true },
  { key: 'supply', label: 'Supply Type', id: true },
  money('taxable', 'Taxable Value'),
  money('igst', 'IGST'),
  money('cgst', 'CGST'),
  money('sgst', 'SGST'),
  money('totalTax', 'Total Tax'),
]

const TAX_COLS: ExportColumn[] = [
  { key: 'head', label: 'Tax head', id: true },
  money('tax', 'Tax payable'),
  money('itc', 'Paid through ITC'),
  money('cash', 'Paid in cash'),
]

export const GSTR3B_EXPORT = defineExport({
  key: 'gst.gstr3b',
  title: 'GSTR-3B',
  noun: 'Rate lines',
  scope: SCOPE,
  columns: RATE_COLS,
  filters: async () => [await sourcesFilter()],
  scopes: ['filtered'],
  dateRange: { label: 'Return period' },
  rangeFromQuery,
  filename: filename('GSTR3B'),
  count: async ctx => {
    const p = period(ctx)
    return (await getGstr3b(p.from, p.to, await pickedSources(ctx))).summary.byGstRate.length
  },
  sections: async ctx => {
    const p = period(ctx)
    const r = await getGstr3b(p.from, p.to, await pickedSources(ctx))
    const o = r.table31.outwardTaxable
    return [
      {
        key: 't31',
        title: '3.1 Outward taxable supplies',
        columns: [money('taxableValue', 'Taxable Value', false), money('integratedTax', 'Integrated Tax', false), money('centralTax', 'Central Tax', false), money('stateTax', 'State/UT Tax', false), money('cess', 'Cess', false)],
        rows: [o],
        totals: null,
      },
      {
        key: 'rates',
        title: 'Tax breakup by GST rate',
        rows: r.summary.byGstRate.map(x => ({ ...x, supply: x.isIgst ? 'Inter-State' : 'Intra-State', totalTax: Math.round((x.cgst + x.sgst + x.igst) * 100) / 100 })),
      },
      {
        key: 't32',
        title: '3.2 Inter-state supplies to unregistered persons',
        columns: [{ key: 'gstRate', label: 'GST Rate', type: 'percent', id: true }, money('taxableValue', 'Taxable Value'), money('igst', 'IGST')],
        rows: r.table32.supplies,
      },
      {
        key: 't6',
        title: '6. Payment of tax',
        columns: TAX_COLS,
        rows: (['igst', 'cgst', 'sgst', 'cess'] as const).map(k => ({ head: k.toUpperCase(), tax: r.table6[k].tax, itc: 0, cash: r.table6[k].cashPaid })),
        summary: [
          { label: 'Invoices', value: r.summary.totalInvoices, type: 'int' },
          { label: 'Taxable value', value: r.summary.totalTaxable, type: 'money' },
          { label: 'Total tax payable', value: r.summary.totalTax, type: 'money' },
        ],
      },
    ]
  },
})

const IRN_STATUS: ExportFilter = {
  key: 'irn',
  label: 'e-Invoice status',
  kind: 'multi',
  options: [
    { value: 'generated', label: 'IRN generated' },
    { value: 'pending', label: 'IRN pending' },
  ],
}

export const IRN_EXPORT = defineExport({
  key: 'gst.irn',
  title: 'e-Invoice (IRN) status',
  noun: 'Invoices',
  scope: SCOPE,
  columns: [
    { key: 'invoice_number', label: 'Invoice No', id: true, width: 1.3 },
    { key: 'invoice_date', label: 'Date', type: 'date', id: true },
    { key: 'buyer_gstin', label: 'Buyer GSTIN', id: true, width: 1.4 },
    { key: 'customer_name', label: 'Customer', width: 1.5 },
    { key: 'type', label: 'Type' },
    { key: 'source', label: 'Revenue source' },
    money('total_amount', 'Amount'),
    { key: 'irn', label: 'IRN', width: 2.2 },
    { key: 'irn_ack_no', label: 'Ack No' },
    { key: 'irn_ack_dt', label: 'Ack Date', type: 'date' },
    { key: 'irn_status', label: 'Status' },
  ],
  filters: async () => [await sourcesFilter(), IRN_STATUS],
  scopes: ['filtered'],
  dateRange: { label: 'Period' },
  rangeFromQuery,
  filename: filename('e-Invoice'),
  sections: async ctx => {
    const p = period(ctx)
    const r = await getGstr1(p.from, p.to, await pickedSources(ctx))
    const statuses = narrowed(IRN_STATUS, ctx.filters)
    const rows = [...r.b2b, ...r.b2c]
      .filter(x => !statuses || statuses.includes(x.irn ? 'generated' : 'pending'))
      .map(x => ({ ...invoiceRow(x), irn_status: x.irn_status && x.irn ? x.irn_status : x.irn ? 'generated' : 'No IRN' }))
    return [{ key: 'irn', rows, summary: [{ label: 'IRN generated', value: rows.filter(x => x.irn).length, type: 'int' }, { label: 'IRN pending', value: rows.filter(x => !x.irn).length, type: 'int' }] }]
  },
})

const NO_GSTIN: ExportFilter = { key: 'gstin_only', label: 'Only suppliers with a GSTIN (ITC-eligible)', kind: 'toggle', default: false }

export const ITC_EXPORT = defineExport({
  key: 'gst.itc',
  title: 'ITC Ledger',
  noun: 'PO lines',
  scope: SCOPE,
  columns: [
    { key: 'po_number', label: 'PO No', id: true, width: 1.2 },
    { key: 'order_date', label: 'Date', type: 'date', id: true },
    { key: 'supplier_gstin', label: 'Supplier GSTIN', id: true, width: 1.4 },
    { key: 'supplier_name', label: 'Supplier', width: 1.4 },
    { key: 'product_name', label: 'Product', width: 1.8 },
    { key: 'sku', label: 'SKU', optional: true },
    { key: 'quantity', label: 'Qty', type: 'number', total: 'sum' },
    money('unit_cost', 'Unit Cost', false),
    { key: 'tax_rate', label: 'GST %', type: 'percent' },
    money('taxable_amount', 'Taxable'),
    money('tax_amount', 'ITC'),
    { key: 'po_status', label: 'PO status', optional: true },
  ],
  filters: [NO_GSTIN],
  scopes: ['filtered'],
  dateRange: { label: 'Period' },
  rangeFromQuery,
  filename: filename('ITC'),
  sections: async ctx => {
    const p = period(ctx)
    let rows = await loadItcRows(p.from, p.to)
    if (ctx.filters.gstin_only === true) rows = rows.filter(r => r.supplier_gstin)
    const s = itcSummary(rows)
    return [
      { key: 'lines', title: 'Line-level detail', rows: rows as unknown as Record<string, unknown>[] },
      {
        key: 'suppliers',
        title: 'By supplier',
        columns: [
          { key: 'supplierName', label: 'Supplier', id: true, width: 1.6 },
          { key: 'gstin', label: 'GSTIN', id: true, width: 1.4 },
          { key: 'poCount', label: 'POs', type: 'int', total: 'sum' },
          money('taxable', 'Taxable'),
          money('tax', 'ITC (Tax)'),
        ],
        rows: s.supplierSummary,
        summary: [
          { label: 'PO line items', value: s.summary.lineCount, type: 'int' },
          { label: 'Total taxable purchases', value: s.summary.totalTaxable, type: 'money' },
          { label: 'Total ITC claimable', value: s.summary.totalTax, type: 'money' },
        ],
      },
    ]
  },
})

export const GST_EXPORTS: ExportDefinition[] = [GSTR1_EXPORT, GSTR3B_EXPORT, IRN_EXPORT, ITC_EXPORT]
