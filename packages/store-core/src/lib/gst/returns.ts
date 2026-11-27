import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { MARKETPLACE_LABELS } from '@/lib/marketplace/sources'

// GSTR-1 and GSTR-3B from paid, invoiced sales: orders (every channel) and counter cash sales.
// The GST page and its exports both call these, so an export's totals are the page's totals under
// the same period and revenue sources.

export const GST_SOURCE_LABELS: Record<string, string> = {
  online: 'Online store',
  offline: 'Offline / counter',
  business: 'B2B portal',
  cash_sale: 'Cash sales',
  ...MARKETPLACE_LABELS,
}

export const gstSourceLabel = (s: string) => GST_SOURCE_LABELS[s] ?? s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

export interface GstItem {
  product_name: string
  hsn_code: string
  uqc: string
  gst_rate: number | string
  quantity: number | string
  taxable_amount: number | string
  cgst_amount: number | string
  sgst_amount: number | string
  igst_amount: number | string
  total_price: number | string
}

export interface GstInvoice {
  kind?: 'order' | 'cash_sale'
  source?: string
  invoice_number: string
  invoice_date: string | Date
  order_number: string | null
  customer_name: string | null
  buyer_gstin: string | null
  is_igst: boolean
  taxable_amount: number | string
  cgst_amount: number | string
  sgst_amount: number | string
  igst_amount: number | string
  total_amount: number | string
  buyer_state: string | null
  irn: string | null
  irn_ack_no: string | null
  irn_ack_dt: string | Date | null
  irn_status?: string | null
  items: GstItem[]
}

export interface Gstr1Summary {
  totalInvoices: number
  b2bCount: number
  b2cCount: number
  totalTaxable: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
  totalTax: number
  totalInvoiceValue: number
}

export interface HsnRow {
  hsnCode: string
  gstRate: number
  uqc: string
  qty: number
  taxableVal: number
  igstAmt: number
  cgstAmt: number
  sgstAmt: number
  totalTax: number
}

export interface SourceRow {
  source: string
  label: string
  invoices: number
  taxable: number
  tax: number
  total: number
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? n : 0
}
const sum = (rows: GstInvoice[], f: keyof GstInvoice) => round2(rows.reduce((a, r) => a + num(r[f]), 0))

/** The invoices whose source is ticked; all of them when `sources` is null. */
export function filterBySource<T extends { source?: string }>(rows: T[], sources: string[] | null): T[] {
  if (!sources) return rows
  const set = new Set(sources)
  return rows.filter(r => set.has(r.source ?? 'online'))
}

export function summarizeGstr1(rows: GstInvoice[]): Gstr1Summary {
  const cgst = sum(rows, 'cgst_amount')
  const sgst = sum(rows, 'sgst_amount')
  const igst = sum(rows, 'igst_amount')
  return {
    totalInvoices: rows.length,
    b2bCount: rows.filter(r => r.buyer_gstin).length,
    b2cCount: rows.filter(r => !r.buyer_gstin).length,
    totalTaxable: sum(rows, 'taxable_amount'),
    totalCgst: cgst,
    totalSgst: sgst,
    totalIgst: igst,
    totalTax: round2(cgst + sgst + igst),
    totalInvoiceValue: sum(rows, 'total_amount'),
  }
}

export function buildHsnSummary(rows: GstInvoice[]): HsnRow[] {
  const map: Record<string, { hsnCode: string; gstRate: number; uqc: string; qty: number; taxableVal: number; igst: number; cgst: number; sgst: number }> = {}
  for (const row of rows) {
    for (const item of row.items || []) {
      const uqc = item.uqc || 'NOS'
      const key = `${item.hsn_code}-${item.gst_rate}-${uqc}`
      if (!map[key]) {
        map[key] = { hsnCode: item.hsn_code || '9999', gstRate: parseFloat(String(item.gst_rate || '18')), uqc, qty: 0, taxableVal: 0, igst: 0, cgst: 0, sgst: 0 }
      }
      map[key].qty += num(item.quantity)
      map[key].taxableVal += num(item.taxable_amount)
      map[key].igst += num(item.igst_amount)
      map[key].cgst += num(item.cgst_amount)
      map[key].sgst += num(item.sgst_amount)
    }
  }
  return Object.values(map).map(h => ({
    hsnCode: h.hsnCode,
    gstRate: h.gstRate,
    uqc: h.uqc,
    qty: round2(h.qty),
    taxableVal: round2(h.taxableVal),
    igstAmt: round2(h.igst),
    cgstAmt: round2(h.cgst),
    sgstAmt: round2(h.sgst),
    totalTax: round2(h.igst + h.cgst + h.sgst),
  }))
}

export function bySource(rows: GstInvoice[]): SourceRow[] {
  const m = new Map<string, SourceRow>()
  for (const r of rows) {
    const s = r.source ?? 'online'
    const row = m.get(s) ?? { source: s, label: gstSourceLabel(s), invoices: 0, taxable: 0, tax: 0, total: 0 }
    row.invoices++
    row.taxable += num(r.taxable_amount)
    row.tax += num(r.cgst_amount) + num(r.sgst_amount) + num(r.igst_amount)
    row.total += num(r.total_amount)
    m.set(s, row)
  }
  return [...m.values()].map(r => ({ ...r, taxable: round2(r.taxable), tax: round2(r.tax), total: round2(r.total) })).sort((a, b) => b.total - a.total)
}

const ITEM_JSON = (t: string) => `json_build_object(
          'product_name', ${t}.product_name,
          -- Lines saved without HSN fall back to the product's category default.
          'hsn_code', COALESCE(NULLIF(${t}.hsn_code, ''), c.default_hsn_code, pc.default_hsn_code, '9999'),
          'uqc', COALESCE(NULLIF(c.default_uqc, ''), NULLIF(pc.default_uqc, ''), 'NOS'),
          'gst_rate', COALESCE(${t}.gst_rate, 18),
          'quantity', ${t}.quantity,
          'taxable_amount', ${t}.taxable_amount,
          'cgst_amount', ${t}.cgst_amount,
          'sgst_amount', ${t}.sgst_amount,
          'igst_amount', ${t}.igst_amount,
          'total_price', ${t}.total_price
        ) ORDER BY ${t}.created_at`

const CATS = (t: string) => `LEFT JOIN products p ON p.id = ${t}.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories pc ON pc.id = c.parent_category_id`

/** Every paid invoice (with its lines) in the period: orders of all channels plus cash sales. */
export async function loadGstInvoices(from: string, to: string): Promise<GstInvoice[]> {
  return queryMany<GstInvoice>(
    `
    SELECT * FROM (
      SELECT 'order' AS kind, o.source, o.invoice_number, o.invoice_date, o.order_number, o.customer_name,
             NULLIF(TRIM(o.buyer_gstin), '') AS buyer_gstin, o.is_igst, o.taxable_amount, o.cgst_amount, o.sgst_amount,
             o.igst_amount, o.total_amount, a.state AS buyer_state, o.irn, o.irn_ack_no, o.irn_ack_dt, o.irn_status,
             (SELECT json_agg(${ITEM_JSON('oi')}) FROM order_items oi ${CATS('oi')} WHERE oi.order_id = o.id) AS items
        FROM orders o
        LEFT JOIN addresses a ON a.id = o.shipping_address_id
       WHERE o.invoice_date >= $1
         AND o.invoice_date < ($2::date + interval '1 day')
         AND o.invoice_number IS NOT NULL
         AND o.payment_status = 'paid'
      UNION ALL
      SELECT 'cash_sale', 'cash_sale', cs.invoice_number, cs.invoice_date, cs.sale_number,
             COALESCE(NULLIF(cs.customer_name, ''), 'Walk-in Customer'), NULL, cs.is_igst, cs.taxable_amount,
             cs.cgst_amount, cs.sgst_amount, cs.igst_amount, cs.total_amount, NULL, NULL, NULL, NULL, NULL,
             (SELECT json_agg(${ITEM_JSON('ci')}) FROM cash_sale_items ci ${CATS('ci')} WHERE ci.sale_id = cs.id)
        FROM cash_sales cs
       WHERE cs.invoice_date >= $1
         AND cs.invoice_date < ($2::date + interval '1 day')
         AND cs.invoice_number IS NOT NULL
         AND cs.payment_status = 'paid'
         AND cs.status <> 'cancelled'
    ) inv
    WHERE inv.items IS NOT NULL
    ORDER BY inv.invoice_date ASC, inv.invoice_number ASC
  `,
    [from, to]
  )
}

export interface Gstr1Report {
  period: { from: string; to: string }
  sources: string[] | null
  summary: Gstr1Summary
  /** Every source in the period, before the source filter (the page's source chips). */
  bySource: SourceRow[]
  b2b: GstInvoice[]
  b2c: GstInvoice[]
  hsnSummary: HsnRow[]
}

export async function getGstr1(from: string, to: string, sources: string[] | null = null): Promise<Gstr1Report> {
  const all = await loadGstInvoices(from, to)
  const rows = filterBySource(all, sources)
  return {
    period: { from, to },
    sources,
    summary: summarizeGstr1(rows),
    bySource: bySource(all),
    b2b: rows.filter(r => r.buyer_gstin),
    b2c: rows.filter(r => !r.buyer_gstin),
    hsnSummary: buildHsnSummary(rows),
  }
}

export interface RateRow {
  gstRate: number
  isIgst: boolean
  b2c: boolean
  taxable: number
  cgst: number
  sgst: number
  igst: number
}

export interface Gstr3bReport {
  period: { from: string; to: string }
  sources: string[] | null
  gstin: string
  legalName: string
  table31: { label: string; outwardTaxable: { taxableValue: number; integratedTax: number; centralTax: number; stateTax: number; cess: number } }
  table32: { label: string; supplies: { gstRate: number; taxableValue: number; igst: number }[] }
  table4: { label: string; note: string; itcAvailable: { igst: number; cgst: number; sgst: number; cess: number } }
  table5: { label: string; exempt: number; nilRated: number; nonGst: number }
  table6: Record<'igst' | 'cgst' | 'sgst' | 'cess', { tax: number; interestLate: number; other: number; tds: number; itcIgst: number; itcCgst: number; itcSgst: number; cashPaid: number }>
  summary: {
    totalInvoices: number
    totalTaxable: number
    totalCgst: number
    totalSgst: number
    totalIgst: number
    totalTax: number
    byGstRate: { gstRate: number; isIgst: boolean; taxable: number; cgst: number; sgst: number; igst: number }[]
  }
}

const INVOICE_SET = `
      SELECT o.id, 'order' AS kind, o.source, NULLIF(TRIM(o.buyer_gstin), '') AS buyer_gstin, o.is_igst,
             o.taxable_amount, o.cgst_amount, o.sgst_amount, o.igst_amount
        FROM orders o
       WHERE o.invoice_date >= $1 AND o.invoice_date < ($2::date + interval '1 day')
         AND o.invoice_number IS NOT NULL AND o.payment_status = 'paid'
         AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
      UNION ALL
      SELECT cs.id, 'cash_sale', 'cash_sale', NULL, cs.is_igst,
             cs.taxable_amount, cs.cgst_amount, cs.sgst_amount, cs.igst_amount
        FROM cash_sales cs
       WHERE cs.invoice_date >= $1 AND cs.invoice_date < ($2::date + interval '1 day')
         AND cs.invoice_number IS NOT NULL AND cs.payment_status = 'paid' AND cs.status <> 'cancelled'
         AND EXISTS (SELECT 1 FROM cash_sale_items ci WHERE ci.sale_id = cs.id)`

const tax = (n: number) => ({ tax: n, interestLate: 0, other: 0, tds: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0, cashPaid: n })

/** Pure: GSTR-3B tables from the outward totals and the per-rate lines. */
export function computeGstr3b(
  outward: { total_taxable?: unknown; total_cgst?: unknown; total_sgst?: unknown; total_igst?: unknown; invoice_count?: unknown } | null,
  byRate: { gst_rate?: unknown; is_igst?: boolean; b2c?: boolean; buyer_gstin?: string | null; taxable?: unknown; cgst?: unknown; sgst?: unknown; igst?: unknown }[],
  settings: Record<string, string>,
  period: { from: string; to: string },
  sources: string[] | null = null
): Gstr3bReport {
  const totalCgst = num(outward?.total_cgst)
  const totalSgst = num(outward?.total_sgst)
  const totalIgst = num(outward?.total_igst)
  const totalTax = round2(totalCgst + totalSgst + totalIgst)
  const rates: RateRow[] = byRate.map(r => ({
    gstRate: num(r.gst_rate),
    isIgst: !!r.is_igst,
    b2c: r.b2c ?? !r.buyer_gstin,
    taxable: num(r.taxable),
    cgst: num(r.cgst),
    sgst: num(r.sgst),
    igst: num(r.igst),
  }))
  // Per-rate rows across B2B and B2C (the page's table); 3.2 keeps only inter-state B2C.
  const merged = new Map<string, { gstRate: number; isIgst: boolean; taxable: number; cgst: number; sgst: number; igst: number }>()
  for (const r of rates) {
    const k = `${r.gstRate}|${r.isIgst}`
    const m = merged.get(k) ?? { gstRate: r.gstRate, isIgst: r.isIgst, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    m.taxable = round2(m.taxable + r.taxable)
    m.cgst = round2(m.cgst + r.cgst)
    m.sgst = round2(m.sgst + r.sgst)
    m.igst = round2(m.igst + r.igst)
    merged.set(k, m)
  }
  const supplies = new Map<number, { gstRate: number; taxableValue: number; igst: number }>()
  for (const r of rates.filter(x => x.isIgst && x.b2c)) {
    const s = supplies.get(r.gstRate) ?? { gstRate: r.gstRate, taxableValue: 0, igst: 0 }
    s.taxableValue = round2(s.taxableValue + r.taxable)
    s.igst = round2(s.igst + r.igst)
    supplies.set(r.gstRate, s)
  }
  return {
    period,
    sources,
    gstin: settings.business_gstin || '',
    legalName: settings.business_legal_name || '',
    table31: {
      label: '3.1 Details of Outward Supplies',
      outwardTaxable: { taxableValue: num(outward?.total_taxable), integratedTax: totalIgst, centralTax: totalCgst, stateTax: totalSgst, cess: 0 },
    },
    table32: { label: '3.2 Inter-state supplies to unregistered persons', supplies: [...supplies.values()].sort((a, b) => a.gstRate - b.gstRate) },
    table4: {
      label: '4. Eligible ITC (manual entry required — purchase data not available)',
      note: 'Purchase cycle module required for auto-population',
      itcAvailable: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    },
    table5: { label: '5. Values exempt/nil-rated/non-GST', exempt: 0, nilRated: 0, nonGst: 0 },
    table6: { igst: tax(totalIgst), cgst: tax(totalCgst), sgst: tax(totalSgst), cess: tax(0) },
    summary: {
      totalInvoices: num(outward?.invoice_count),
      totalTaxable: num(outward?.total_taxable),
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax,
      byGstRate: [...merged.values()].sort((a, b) => a.gstRate - b.gstRate || Number(a.isIgst) - Number(b.isIgst)),
    },
  }
}

export async function getGstr3b(from: string, to: string, sources: string[] | null = null): Promise<Gstr3bReport> {
  const params: unknown[] = [from, to]
  let pick = ''
  if (sources) {
    params.push(sources)
    pick = 'WHERE inv.source = ANY($3::text[])'
  }
  const outward = await queryOne(
    `SELECT SUM(inv.taxable_amount)::numeric AS total_taxable,
            SUM(inv.cgst_amount)::numeric    AS total_cgst,
            SUM(inv.sgst_amount)::numeric    AS total_sgst,
            SUM(inv.igst_amount)::numeric    AS total_igst,
            COUNT(*)::int                    AS invoice_count
       FROM (${INVOICE_SET}) inv ${pick}`,
    params
  )
  const byRate = await queryMany(
    `SELECT COALESCE(l.gst_rate, 18) AS gst_rate, inv.is_igst, inv.buyer_gstin IS NULL AS b2c,
            SUM(l.taxable_amount)::numeric AS taxable,
            SUM(l.cgst_amount)::numeric    AS cgst,
            SUM(l.sgst_amount)::numeric    AS sgst,
            SUM(l.igst_amount)::numeric    AS igst
       FROM (${INVOICE_SET}) inv
       JOIN LATERAL (
         SELECT oi.gst_rate, oi.taxable_amount, oi.cgst_amount, oi.sgst_amount, oi.igst_amount
           FROM order_items oi WHERE inv.kind = 'order' AND oi.order_id = inv.id
         UNION ALL
         SELECT ci.gst_rate, ci.taxable_amount, ci.cgst_amount, ci.sgst_amount, ci.igst_amount
           FROM cash_sale_items ci WHERE inv.kind = 'cash_sale' AND ci.sale_id = inv.id
       ) l ON TRUE
       ${pick}
      GROUP BY 1, 2, 3
      ORDER BY 1`,
    params
  )
  const settingsRows = await queryMany("SELECT key, value FROM site_settings WHERE key LIKE 'business_%'", [])
  const s: Record<string, string> = {}
  for (const row of settingsRows) s[row.key] = row.value || ''
  return computeGstr3b(outward, byRate, s, { from, to }, sources)
}

/** Revenue sources that have ever been invoiced (the export's include/exclude choices). */
export async function invoicedSources(): Promise<string[]> {
  const rows = await queryMany<{ source: string }>(
    `SELECT DISTINCT o.source FROM orders o WHERE o.invoice_number IS NOT NULL AND o.payment_status = 'paid'
     UNION
     SELECT 'cash_sale' WHERE EXISTS (SELECT 1 FROM cash_sales cs WHERE cs.invoice_number IS NOT NULL)`,
    []
  )
  const order = Object.keys(GST_SOURCE_LABELS)
  return rows.map(r => r.source).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
}

/** `sources` query param: null when absent (every source), else the listed ones. */
export function parseSources(raw: string | null): string[] | null {
  if (raw == null) return null
  return [...new Set(raw.split(/[|,]/).map(s => s.trim()).filter(s => /^[a-z_]{1,32}$/.test(s)))]
}

export interface ItcRow {
  po_id: string
  po_number: string
  order_date: string | Date
  supplier_name: string
  supplier_gstin: string | null
  product_name: string
  sku: string
  quantity: number | string
  unit_cost: number | string
  tax_rate: number | string
  taxable_amount: number | string
  tax_amount: number | string
  po_status: string
}

export async function loadItcRows(from: string, to: string): Promise<ItcRow[]> {
  return queryMany<ItcRow>(
    `
      SELECT
        po.id AS po_id,
        po.po_number,
        po.order_date,
        s.name AS supplier_name,
        s.gstin AS supplier_gstin,
        poi.product_name,
        COALESCE(poi.sku, '') AS sku,
        poi.quantity,
        poi.unit_cost,
        COALESCE(poi.tax_rate, 0)::numeric AS tax_rate,
        ROUND(poi.quantity * poi.unit_cost, 2) AS taxable_amount,
        ROUND(poi.quantity * poi.unit_cost * COALESCE(poi.tax_rate, 0) / 100, 2) AS tax_amount,
        po.status AS po_status
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.order_date >= $1
        AND po.order_date < ($2::date + interval '1 day')
        AND po.status IN ('received', 'partial')
      ORDER BY po.order_date ASC, po.po_number ASC
    `,
    [from, to]
  )
}

export function itcSummary(rows: ItcRow[]) {
  const totalTaxable = rows.reduce((s, r) => s + num(r.taxable_amount), 0)
  const totalTax = rows.reduce((s, r) => s + num(r.tax_amount), 0)
  const by: Record<string, { supplierName: string; gstin: string | null; taxable: number; tax: number; pos: Set<string> }> = {}
  for (const r of rows) {
    const k = r.supplier_name
    by[k] ??= { supplierName: r.supplier_name, gstin: r.supplier_gstin, taxable: 0, tax: 0, pos: new Set() }
    by[k].taxable += num(r.taxable_amount)
    by[k].tax += num(r.tax_amount)
    by[k].pos.add(r.po_id)
  }
  return {
    summary: { lineCount: rows.length, totalTaxable: round2(totalTaxable), totalTax: round2(totalTax) },
    supplierSummary: Object.values(by).map(s => ({ supplierName: s.supplierName, gstin: s.gstin, poCount: s.pos.size, taxable: round2(s.taxable), tax: round2(s.tax) })),
  }
}
