import type { Bucket, Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { queryMany, queryOne } from '@/lib/shared/db'
import {
  BOUNDS,
  TODAY_IST,
  bucketsCte,
  byPeriod,
  fillKeyed,
  inBucket,
  istDay,
  num,
  periodArgs,
  str,
  type Row,
} from './sales-documents'

// Invoices = numbered orders (not cash_sale-sourced) plus numbered cash sales, the same union the
// invoice list shows. A cancelled order or cash sale is a voided invoice. Unpaid ages from the
// invoice date (no credit terms are stored), like Finance receivables.

const PAID = `('paid', 'cod_collected')`
const UNPAID = `('unpaid', 'partial', 'cod_pending')`
// Receivable = unpaid on an order that is still live (Finance receivables definition).
const RECEIVABLE = `payment_status IN ('unpaid', 'partial') AND status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')`
export const OVERDUE_DAYS = 30

const INV = `inv AS (
  SELECT 'order'::text AS kind, o.id, o.invoice_number, o.invoice_date AS at,
         COALESCE(NULLIF(o.customer_name, ''), 'Customer') AS customer,
         NULLIF(TRIM(o.buyer_gstin), '') AS gstin, o.total_amount AS amount,
         COALESCE(o.taxable_amount, 0) AS taxable,
         COALESCE(o.cgst_amount, 0) + COALESCE(o.sgst_amount, 0) + COALESCE(o.igst_amount, 0) AS gst,
         o.payment_status, COALESCE(o.status, '') AS status, o.status = 'cancelled' AS voided,
         o.source, o.irn_status
    FROM orders o
   WHERE o.invoice_number IS NOT NULL AND o.source <> 'cash_sale' AND o.invoice_date IS NOT NULL
  UNION ALL
  SELECT 'cash_sale', cs.id, cs.invoice_number, cs.invoice_date, COALESCE(NULLIF(cs.customer_name, ''), 'Walk-in Customer'),
         NULL, cs.total_amount, cs.taxable_amount, cs.cgst_amount + cs.sgst_amount + cs.igst_amount,
         cs.payment_status, cs.status, cs.status = 'cancelled', 'cash_sale', NULL
    FROM cash_sales cs
   WHERE cs.invoice_number IS NOT NULL AND cs.invoice_date IS NOT NULL
)`

export const INVOICE_SQL = {
  kpis: `WITH ${BOUNDS}, ${INV}
    SELECT CASE WHEN at >= b.c0 THEN 'cur' ELSE 'prev' END AS period,
           COUNT(*) FILTER (WHERE NOT voided) AS invoices,
           COUNT(*) FILTER (WHERE voided) AS voided,
           COALESCE(SUM(amount) FILTER (WHERE NOT voided), 0) AS value,
           COALESCE(SUM(taxable) FILTER (WHERE NOT voided), 0) AS taxable,
           COALESCE(SUM(gst) FILTER (WHERE NOT voided), 0) AS gst,
           COALESCE(SUM(amount) FILTER (WHERE NOT voided AND payment_status IN ${PAID}), 0) AS paid_value,
           COUNT(*) FILTER (WHERE NOT voided AND payment_status IN ${PAID}) AS paid,
           COALESCE(SUM(amount) FILTER (WHERE NOT voided AND payment_status IN ${UNPAID}), 0) AS unpaid_value,
           COUNT(*) FILTER (WHERE NOT voided AND payment_status IN ${UNPAID}) AS unpaid,
           COALESCE(SUM(amount) FILTER (WHERE NOT voided AND payment_status = 'refunded'), 0) AS refunded_value,
           COUNT(*) FILTER (WHERE NOT voided AND gstin IS NOT NULL) AS b2b,
           COUNT(*) FILTER (WHERE NOT voided AND gstin IS NOT NULL AND irn_status = 'generated') AS b2b_irn,
           COUNT(DISTINCT customer) FILTER (WHERE NOT voided) AS customers
      FROM inv, b
     WHERE at >= b.p0 AND at < b.c1
     GROUP BY 1`,
  aging: `WITH ${INV}
    SELECT CASE WHEN d <= 30 THEN 'd0_30' WHEN d <= 60 THEN 'd31_60' WHEN d <= 90 THEN 'd61_90' ELSE 'd90_plus' END AS bucket,
           COUNT(*) AS n, SUM(amount) AS amount
      FROM (SELECT amount, (${TODAY_IST} - ${istDay('at')})::int AS d FROM inv WHERE ${RECEIVABLE}) x
     GROUP BY 1`,
  oldestUnpaid: `WITH ${INV}
    SELECT kind, id, invoice_number, customer, amount, at, (${TODAY_IST} - ${istDay('at')})::int AS days
      FROM inv WHERE ${RECEIVABLE}
     ORDER BY at ASC LIMIT 8`,
  byRate: `WITH ${BOUNDS},
    lines AS (
      SELECT oi.gst_rate AS rate, COALESCE(oi.taxable_amount, 0) AS taxable,
             COALESCE(oi.cgst_amount, 0) + COALESCE(oi.sgst_amount, 0) + COALESCE(oi.igst_amount, 0) AS gst
        FROM order_items oi JOIN orders o ON o.id = oi.order_id, b
       WHERE o.invoice_number IS NOT NULL AND o.source <> 'cash_sale' AND o.status <> 'cancelled'
         AND o.invoice_date >= b.c0 AND o.invoice_date < b.c1
      UNION ALL
      SELECT csi.gst_rate, csi.taxable_amount, csi.cgst_amount + csi.sgst_amount + csi.igst_amount
        FROM cash_sale_items csi JOIN cash_sales cs ON cs.id = csi.sale_id, b
       WHERE cs.invoice_number IS NOT NULL AND cs.status <> 'cancelled'
         AND cs.invoice_date >= b.c0 AND cs.invoice_date < b.c1
    )
    SELECT rate, COUNT(*) AS lines, SUM(taxable) AS taxable, SUM(gst) AS gst
      FROM lines GROUP BY rate ORDER BY rate NULLS LAST`,
  bySource: `WITH ${BOUNDS}, ${INV}
    SELECT source, COUNT(*) AS n, SUM(amount) AS amount
      FROM inv, b WHERE NOT voided AND at >= b.c0 AND at < b.c1
     GROUP BY source ORDER BY amount DESC`,
  topCustomers: `WITH ${BOUNDS}, ${INV}
    SELECT customer, COUNT(*) AS n, SUM(amount) AS amount,
           SUM(amount) FILTER (WHERE payment_status IN ${UNPAID}) AS unpaid
      FROM inv, b WHERE NOT voided AND at >= b.c0 AND at < b.c1
     GROUP BY customer ORDER BY amount DESC LIMIT 8`,
  series: (bucket: Bucket) => `WITH ${BOUNDS}, ${INV}, ${bucketsCte(bucket)}
    SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
           COUNT(inv.id) AS invoices, COALESCE(SUM(inv.amount), 0) AS value, COALESCE(SUM(inv.gst), 0) AS gst
      FROM k CROSS JOIN b
      LEFT JOIN inv ON NOT inv.voided AND inv.at >= b.c0 AND inv.at < b.c1 AND ${inBucket('inv.at', bucket)}
     GROUP BY k.bucket ORDER BY k.bucket`,
  // Snapshot: draft invoices on live orders, B2B invoices without an IRN in the last 90 days.
  pending: `WITH ${INV}
    SELECT (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.id = i.order_id
             WHERE i.status = 'draft' AND o.status <> 'cancelled') AS drafts,
           (SELECT COUNT(*) FROM inv WHERE NOT voided AND gstin IS NOT NULL AND COALESCE(irn_status, 'pending') <> 'generated'
               AND at >= now() - INTERVAL '90 days') AS b2b_no_irn`,
}

export const AGING_KEYS = [
  { key: 'd0_30', label: '0-30 days' },
  { key: 'd31_60', label: '31-60 days' },
  { key: 'd61_90', label: '61-90 days' },
  { key: 'd90_plus', label: '90+ days' },
] as const

export interface InvoiceStats {
  invoices: number
  voided: number
  value: number
  taxable: number
  gst: number
  paidValue: number
  paid: number
  unpaidValue: number
  unpaid: number
  refundedValue: number
  b2b: number
  b2bIrn: number
  customers: number
  avgInvoice: number | null
  eInvoiceCoverage: number | null
}

export function invoiceStats(r: Row | undefined): InvoiceStats {
  const invoices = num(r?.invoices)
  const value = num(r?.value)
  const b2b = num(r?.b2b)
  const b2bIrn = num(r?.b2b_irn)
  return {
    invoices,
    voided: num(r?.voided),
    value,
    taxable: num(r?.taxable),
    gst: num(r?.gst),
    paidValue: num(r?.paid_value),
    paid: num(r?.paid),
    unpaidValue: num(r?.unpaid_value),
    unpaid: num(r?.unpaid),
    refundedValue: num(r?.refunded_value),
    b2b,
    b2bIrn,
    customers: num(r?.customers),
    avgInvoice: invoices ? value / invoices : null,
    eInvoiceCoverage: b2b ? b2bIrn / b2b : null,
  }
}

const invoiceHref = (kind: string, id: string) =>
  kind === 'cash_sale' ? `/admin/cash-sale/${id}/view` : `/admin/invoices/${id}/view`

export function invoiceAttention(a: {
  aging: { key: string; count: number; amount: number }[]
  drafts: number
  b2bNoIrn: number
  voided: number
}): AttentionItem[] {
  const out: AttentionItem[] = []
  const over = a.aging.filter(b => b.key !== 'd0_30')
  const overN = over.reduce((s, b) => s + b.count, 0)
  const overAmt = over.reduce((s, b) => s + b.amount, 0)
  const old = a.aging.filter(b => b.key === 'd61_90' || b.key === 'd90_plus').reduce((s, b) => s + b.count, 0)
  if (overN)
    out.push({
      key: 'overdue',
      severity: old ? 'critical' : 'warning',
      title: `${overN} unpaid invoice${overN === 1 ? '' : 's'} older than ${OVERDUE_DAYS} days`,
      sub: `₹${Math.round(overAmt).toLocaleString('en-IN')} outstanding${old ? `, ${old} over 60 days` : ''}`,
      href: '/admin/invoices?tab=list&payment=unpaid',
    })
  if (a.drafts)
    out.push({
      key: 'drafts',
      severity: 'warning',
      title: `${a.drafts} draft invoice${a.drafts === 1 ? '' : 's'} not finalized`,
      sub: 'Draft invoices have no number until finalized',
      href: '/admin/invoices?tab=list',
    })
  if (a.b2bNoIrn)
    out.push({
      key: 'irn',
      severity: 'info',
      title: `${a.b2bNoIrn} B2B invoice${a.b2bNoIrn === 1 ? '' : 's'} without an e-invoice IRN`,
      sub: 'Last 90 days, invoices with a buyer GSTIN',
      href: '/admin/invoices?tab=list&source=business',
    })
  if (a.voided)
    out.push({
      key: 'voided',
      severity: 'info',
      title: `${a.voided} invoice${a.voided === 1 ? '' : 's'} voided in this period`,
    })
  return out
}

export async function loadInvoiceOverview(period: Period) {
  const { previous, bucket, args } = periodArgs(period)
  const [kpiRows, agingRows, oldest, rates, sources, customers, series, pending] = await Promise.all([
    queryMany<Row>(INVOICE_SQL.kpis, args),
    queryMany<Row>(INVOICE_SQL.aging),
    queryMany<Row>(INVOICE_SQL.oldestUnpaid),
    queryMany<Row>(INVOICE_SQL.byRate, args),
    queryMany<Row>(INVOICE_SQL.bySource, args),
    queryMany<Row>(INVOICE_SQL.topCustomers, args),
    queryMany<Row>(INVOICE_SQL.series(bucket), args),
    queryOne<Row>(INVOICE_SQL.pending),
  ])
  const kpis = byPeriod(kpiRows, invoiceStats)
  const aging = fillKeyed(AGING_KEYS, agingRows)
  return {
    period,
    previous,
    bucket,
    kpis,
    outstanding: {
      total: aging.reduce((s, b) => s + b.amount, 0),
      count: aging.reduce((s, b) => s + b.count, 0),
      overdue: aging.filter(b => b.key !== 'd0_30').reduce((s, b) => s + b.amount, 0),
      aging,
    },
    oldestUnpaid: oldest.map(r => ({
      id: str(r.id),
      number: str(r.invoice_number),
      customer: str(r.customer),
      amount: num(r.amount),
      date: r.at,
      days: num(r.days),
      href: invoiceHref(str(r.kind), str(r.id)),
    })),
    byRate: rates.map(r => ({
      rate: r.rate == null ? null : num(r.rate),
      lines: num(r.lines),
      taxable: num(r.taxable),
      gst: num(r.gst),
    })),
    bySource: sources.map(r => ({ source: str(r.source), count: num(r.n), amount: num(r.amount) })),
    topCustomers: customers.map(r => ({
      name: str(r.customer),
      count: num(r.n),
      amount: num(r.amount),
      unpaid: num(r.unpaid),
    })),
    series: series.map(r => ({ label: str(r.label), invoices: num(r.invoices), value: num(r.value), gst: num(r.gst) })),
    attention: invoiceAttention({
      aging,
      drafts: num(pending?.drafts),
      b2bNoIrn: num(pending?.b2b_no_irn),
      voided: kpis.current.voided,
    }),
  }
}

export type InvoiceOverview = Awaited<ReturnType<typeof loadInvoiceOverview>>
