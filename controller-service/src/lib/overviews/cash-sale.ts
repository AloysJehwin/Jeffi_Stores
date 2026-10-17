import type { Bucket, Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import { queryMany, queryOne } from '@/lib/shared/db'
import {
  BOUNDS,
  TODAY_IST,
  bucketsCte,
  byPeriod,
  inBucket,
  istDay,
  num,
  periodArgs,
  str,
  type Row,
} from './sales-documents'

// Counter (POS) sales from cash_sales, dated by invoice_date like the cash-sale list. A cancelled
// sale (status 'cancelled') is excluded from sales and counted separately. Cash sales record no
// cashier, so there is no per-cashier split.

const AT = 'COALESCE(cs.invoice_date, cs.created_at)'
const LIVE = `cs.status <> 'cancelled'`
export const CANCEL_RATE_WARN = 0.1

export const CASH_SALE_SQL = {
  kpis: `WITH ${BOUNDS}
    SELECT CASE WHEN ${AT} >= b.c0 THEN 'cur' ELSE 'prev' END AS period,
           COUNT(*) FILTER (WHERE ${LIVE}) AS bills,
           COALESCE(SUM(cs.total_amount) FILTER (WHERE ${LIVE}), 0) AS sales,
           COALESCE(SUM(cs.taxable_amount) FILTER (WHERE ${LIVE}), 0) AS taxable,
           COALESCE(SUM(cs.cgst_amount + cs.sgst_amount + cs.igst_amount) FILTER (WHERE ${LIVE}), 0) AS gst,
           COUNT(*) FILTER (WHERE NOT ${LIVE}) AS cancelled,
           COALESCE(SUM(cs.total_amount) FILTER (WHERE NOT ${LIVE}), 0) AS cancelled_value,
           COUNT(DISTINCT ${istDay(AT)}) FILTER (WHERE ${LIVE}) AS trading_days
      FROM cash_sales cs, b
     WHERE ${AT} >= b.p0 AND ${AT} < b.c1
     GROUP BY 1`,
  units: `WITH ${BOUNDS}
    SELECT CASE WHEN ${AT} >= b.c0 THEN 'cur' ELSE 'prev' END AS period,
           COALESCE(SUM(csi.quantity), 0) AS units, COUNT(*) AS lines
      FROM cash_sale_items csi JOIN cash_sales cs ON cs.id = csi.sale_id, b
     WHERE ${LIVE} AND ${AT} >= b.p0 AND ${AT} < b.c1
     GROUP BY 1`,
  today: `SELECT
      COUNT(*) FILTER (WHERE ${istDay(AT)} = ${TODAY_IST}) AS bills,
      COALESCE(SUM(cs.total_amount) FILTER (WHERE ${istDay(AT)} = ${TODAY_IST}), 0) AS sales,
      COUNT(*) FILTER (WHERE ${istDay(AT)} = ${TODAY_IST} - 7) AS last_week_bills,
      COALESCE(SUM(cs.total_amount) FILTER (WHERE ${istDay(AT)} = ${TODAY_IST} - 7), 0) AS last_week_sales
    FROM cash_sales cs
    WHERE ${LIVE} AND ${AT} >= now() - INTERVAL '9 days'`,
  byMode: `WITH ${BOUNDS}
    SELECT cs.payment_mode AS mode, COUNT(*) AS n, SUM(cs.total_amount) AS amount
      FROM cash_sales cs, b
     WHERE ${LIVE} AND ${AT} >= b.c0 AND ${AT} < b.c1
     GROUP BY 1 ORDER BY amount DESC`,
  byHour: `WITH ${BOUNDS}
    SELECT h AS hour, COUNT(cs.id) AS n, COALESCE(SUM(cs.total_amount), 0) AS amount
      FROM generate_series(0, 23) h
      CROSS JOIN b
      LEFT JOIN cash_sales cs ON ${LIVE} AND ${AT} >= b.c0 AND ${AT} < b.c1
                             AND EXTRACT(HOUR FROM ${AT} AT TIME ZONE 'Asia/Kolkata') = h
     GROUP BY h ORDER BY h`,
  topItems: `WITH ${BOUNDS}
    SELECT csi.product_id, MIN(csi.product_name) AS name, COALESCE(SUM(csi.quantity), 0) AS units,
           COALESCE(SUM(csi.total_price), 0) AS amount, COUNT(DISTINCT cs.id) AS bills
      FROM cash_sale_items csi JOIN cash_sales cs ON cs.id = csi.sale_id, b
     WHERE ${LIVE} AND ${AT} >= b.c0 AND ${AT} < b.c1
     GROUP BY csi.product_id, csi.variant_id, csi.sub_variant_id, CASE WHEN csi.product_id IS NULL THEN csi.product_name END
     ORDER BY amount DESC LIMIT 10`,
  unlinked: `WITH ${BOUNDS}
    SELECT COUNT(*) AS lines, COALESCE(SUM(csi.total_price), 0) AS amount
      FROM cash_sale_items csi JOIN cash_sales cs ON cs.id = csi.sale_id, b
     WHERE ${LIVE} AND csi.product_id IS NULL AND ${AT} >= b.c0 AND ${AT} < b.c1`,
  series: (bucket: Bucket) => `WITH ${BOUNDS}, ${bucketsCte(bucket)}
    SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label, COUNT(cs.id) AS bills, COALESCE(SUM(cs.total_amount), 0) AS sales
      FROM k CROSS JOIN b
      LEFT JOIN cash_sales cs ON ${LIVE} AND ${AT} >= b.c0 AND ${AT} < b.c1 AND ${inBucket(AT, bucket)}
     GROUP BY k.bucket ORDER BY k.bucket`,
}

export interface CashSaleStats {
  bills: number
  sales: number
  taxable: number
  gst: number
  cancelled: number
  cancelledValue: number
  tradingDays: number
  avgBill: number | null
  perDay: number | null
  cancelRate: number | null
}

export function cashSaleStats(r: Row | undefined): CashSaleStats {
  const bills = num(r?.bills)
  const sales = num(r?.sales)
  const cancelled = num(r?.cancelled)
  const tradingDays = num(r?.trading_days)
  return {
    bills,
    sales,
    taxable: num(r?.taxable),
    gst: num(r?.gst),
    cancelled,
    cancelledValue: num(r?.cancelled_value),
    tradingDays,
    avgBill: bills ? sales / bills : null,
    perDay: tradingDays ? sales / tradingDays : null,
    cancelRate: bills + cancelled ? cancelled / (bills + cancelled) : null,
  }
}

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi_qr: 'UPI (QR)',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
}
export const paymentModeLabel = (m: string) =>
  MODE_LABELS[m] ?? m.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

export function cashSaleAttention(a: {
  current: CashSaleStats
  unlinkedLines: number
  unlinkedAmount: number
}): AttentionItem[] {
  const out: AttentionItem[] = []
  const { cancelled, cancelledValue, cancelRate } = a.current
  if (cancelled)
    out.push({
      key: 'cancelled',
      severity: cancelRate != null && cancelRate >= CANCEL_RATE_WARN ? 'warning' : 'info',
      title: `${cancelled} cash sale${cancelled === 1 ? '' : 's'} cancelled in this period`,
      sub: `₹${Math.round(cancelledValue).toLocaleString('en-IN')} reversed${cancelRate != null ? `, ${(cancelRate * 100).toFixed(1)}% of bills` : ''}`,
      href: '/admin/cash-sale?tab=list&payment=cancelled',
    })
  if (a.unlinkedLines)
    out.push({
      key: 'unlinked',
      severity: 'info',
      title: `${a.unlinkedLines} line${a.unlinkedLines === 1 ? '' : 's'} sold without a catalogue product`,
      sub: `₹${Math.round(a.unlinkedAmount).toLocaleString('en-IN')} not tracked against stock`,
    })
  return out
}

export async function loadCashSaleOverview(period: Period) {
  const { previous, bucket, args } = periodArgs(period)
  const [kpiRows, unitRows, today, modes, hours, items, unlinked, series] = await Promise.all([
    queryMany<Row>(CASH_SALE_SQL.kpis, args),
    queryMany<Row>(CASH_SALE_SQL.units, args),
    queryOne<Row>(CASH_SALE_SQL.today),
    queryMany<Row>(CASH_SALE_SQL.byMode, args),
    queryMany<Row>(CASH_SALE_SQL.byHour, args),
    queryMany<Row>(CASH_SALE_SQL.topItems, args),
    queryOne<Row>(CASH_SALE_SQL.unlinked, args),
    queryMany<Row>(CASH_SALE_SQL.series(bucket), args),
  ])
  const kpis = byPeriod(kpiRows, cashSaleStats)
  return {
    period,
    previous,
    bucket,
    kpis,
    units: byPeriod(unitRows, r => ({ units: num(r?.units), lines: num(r?.lines) })),
    today: {
      bills: num(today?.bills),
      sales: num(today?.sales),
      lastWeekBills: num(today?.last_week_bills),
      lastWeekSales: num(today?.last_week_sales),
    },
    byMode: modes.map(r => ({
      mode: str(r.mode),
      label: paymentModeLabel(str(r.mode)),
      count: num(r.n),
      amount: num(r.amount),
    })),
    byHour: hours.map(r => ({ hour: num(r.hour), count: num(r.n), amount: num(r.amount) })),
    topItems: items.map(r => ({
      productId: r.product_id ? str(r.product_id) : null,
      name: str(r.name),
      units: num(r.units),
      amount: num(r.amount),
      bills: num(r.bills),
    })),
    series: series.map(r => ({ label: str(r.label), bills: num(r.bills), sales: num(r.sales) })),
    attention: cashSaleAttention({
      current: kpis.current,
      unlinkedLines: num(unlinked?.lines),
      unlinkedAmount: num(unlinked?.amount),
    }),
  }
}

export type CashSaleOverview = Awaited<ReturnType<typeof loadCashSaleOverview>>
