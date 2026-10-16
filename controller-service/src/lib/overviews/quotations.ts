import type { Bucket, Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { queryMany, queryOne } from '@/lib/shared/db'
import { BOUNDS, TODAY_IST, bucketsCte, byPeriod, num, numOrNull, periodArgs, str, type Row } from './sales-documents'

// A quotation is "sent" once finalized (status 'final'), dated by quote_date, and "accepted" once
// converted to an invoice (converted_order_id). No validity date is stored, so a quote is treated
// as open for QUOTE_VALID_DAYS from its quote date.

export const QUOTE_VALID_DAYS = 30
export const STALE_DRAFT_DAYS = 3

const CUSTOMER = `COALESCE(NULLIF(TRIM(CASE WHEN q.buyer_same THEN q.consignee_name ELSE q.buyer_name END), ''), 'Unnamed')`
const AGE = `(${TODAY_IST} - q.quote_date)`
const OPEN = `q.status = 'final' AND q.converted_order_id IS NULL`

export const QUOTATION_SQL = {
  // Cohort of quotes dated in each period; accepted counts whenever they converted.
  kpis: `WITH ${BOUNDS}
    SELECT CASE WHEN q.quote_date >= $2::date THEN 'cur' ELSE 'prev' END AS period,
           COUNT(*) AS created,
           COUNT(*) FILTER (WHERE q.status = 'final') AS sent,
           COALESCE(SUM(q.total_amount) FILTER (WHERE q.status = 'final'), 0) AS sent_value,
           COUNT(*) FILTER (WHERE q.converted_order_id IS NOT NULL) AS accepted,
           COALESCE(SUM(q.total_amount) FILTER (WHERE q.converted_order_id IS NOT NULL), 0) AS accepted_value,
           COUNT(DISTINCT ${CUSTOMER}) FILTER (WHERE q.status = 'final') AS customers
      FROM quotations q
     WHERE q.quote_date >= $1::date AND q.quote_date <= $3::date
     GROUP BY 1`,
  // Conversions that happened in each period (by invoice creation), with days from quote to order.
  won: `WITH ${BOUNDS}
    SELECT CASE WHEN o.created_at >= b.c0 THEN 'cur' ELSE 'prev' END AS period,
           COUNT(*) AS won, COALESCE(SUM(o.total_amount), 0) AS won_value,
           AVG(EXTRACT(EPOCH FROM (o.created_at - q.created_at)) / 86400) AS avg_days
      FROM quotations q JOIN orders o ON o.id = q.converted_order_id, b
     WHERE o.created_at >= b.p0 AND o.created_at < b.c1
     GROUP BY 1`,
  pipeline: `SELECT
      COUNT(*) FILTER (WHERE ${OPEN} AND ${AGE} <= ${QUOTE_VALID_DAYS}) AS open,
      COALESCE(SUM(q.total_amount) FILTER (WHERE ${OPEN} AND ${AGE} <= ${QUOTE_VALID_DAYS}), 0) AS open_value,
      COUNT(*) FILTER (WHERE ${OPEN} AND ${AGE} BETWEEN ${QUOTE_VALID_DAYS - 7} AND ${QUOTE_VALID_DAYS}) AS expiring,
      COALESCE(SUM(q.total_amount) FILTER (WHERE ${OPEN} AND ${AGE} BETWEEN ${QUOTE_VALID_DAYS - 7} AND ${QUOTE_VALID_DAYS}), 0) AS expiring_value,
      COUNT(*) FILTER (WHERE ${OPEN} AND ${AGE} > ${QUOTE_VALID_DAYS}) AS lapsed,
      COALESCE(SUM(q.total_amount) FILTER (WHERE ${OPEN} AND ${AGE} > ${QUOTE_VALID_DAYS}), 0) AS lapsed_value,
      COUNT(*) FILTER (WHERE q.status = 'draft' AND q.created_at < now() - INTERVAL '${STALE_DRAFT_DAYS} days') AS stale_drafts
    FROM quotations q`,
  expiring: `SELECT q.id, q.quote_number, ${CUSTOMER} AS customer, q.total_amount, q.quote_date,
           (${QUOTE_VALID_DAYS} - ${AGE})::int AS days_left
      FROM quotations q
     WHERE ${OPEN} AND ${AGE} BETWEEN 0 AND ${QUOTE_VALID_DAYS}
     ORDER BY ${AGE} DESC, q.total_amount DESC LIMIT 8`,
  topCustomers: `WITH ${BOUNDS}
    SELECT ${CUSTOMER} AS customer, COUNT(*) AS quotes, COALESCE(SUM(q.total_amount), 0) AS quoted,
           COUNT(*) FILTER (WHERE q.converted_order_id IS NOT NULL) AS accepted,
           COALESCE(SUM(q.total_amount) FILTER (WHERE q.converted_order_id IS NOT NULL), 0) AS accepted_value
      FROM quotations q
     WHERE q.status = 'final' AND q.quote_date >= $2::date AND q.quote_date <= $3::date
     GROUP BY 1 ORDER BY quoted DESC LIMIT 8`,
  series: (bucket: Bucket) => `WITH ${BOUNDS}, ${bucketsCte(bucket)}
    SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
           COUNT(q.id) AS sent, COALESCE(SUM(q.total_amount), 0) AS sent_value,
           COUNT(q.converted_order_id) AS accepted
      FROM k
      LEFT JOIN quotations q ON q.status = 'final' AND q.quote_date >= $2::date AND q.quote_date <= $3::date
                            AND date_trunc('${bucket}', q.quote_date::timestamp) = k.bucket
     GROUP BY k.bucket ORDER BY k.bucket`,
}

export interface QuoteStats {
  created: number
  sent: number
  sentValue: number
  accepted: number
  acceptedValue: number
  customers: number
  conversion: number | null
  valueConversion: number | null
  avgQuote: number | null
}

export function quoteStats(r: Row | undefined): QuoteStats {
  const sent = num(r?.sent)
  const sentValue = num(r?.sent_value)
  const accepted = num(r?.accepted)
  const acceptedValue = num(r?.accepted_value)
  return {
    created: num(r?.created),
    sent,
    sentValue,
    accepted,
    acceptedValue,
    customers: num(r?.customers),
    conversion: sent ? accepted / sent : null,
    valueConversion: sentValue ? acceptedValue / sentValue : null,
    avgQuote: sent ? sentValue / sent : null,
  }
}

export function quotationAttention(p: {
  expiring: number
  expiringValue: number
  lapsed: number
  lapsedValue: number
  staleDrafts: number
}): AttentionItem[] {
  const out: AttentionItem[] = []
  const rs = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
  if (p.expiring)
    out.push({
      key: 'expiring',
      severity: 'warning',
      title: `${p.expiring} open quotation${p.expiring === 1 ? '' : 's'} expiring this week`,
      sub: `${rs(p.expiringValue)} to follow up before day ${QUOTE_VALID_DAYS}`,
      href: '/admin/quotations?tab=list&status=final',
    })
  if (p.staleDrafts)
    out.push({
      key: 'drafts',
      severity: 'info',
      title: `${p.staleDrafts} draft quotation${p.staleDrafts === 1 ? '' : 's'} older than ${STALE_DRAFT_DAYS} days`,
      sub: 'Finalize and send, or delete',
      href: '/admin/quotations?tab=list&status=draft',
    })
  if (p.lapsed)
    out.push({
      key: 'lapsed',
      severity: 'info',
      title: `${p.lapsed} quotation${p.lapsed === 1 ? '' : 's'} past ${QUOTE_VALID_DAYS} days without an order`,
      sub: `${rs(p.lapsedValue)} quoted; re-quote or close`,
      href: '/admin/quotations?tab=list&status=final',
    })
  return out
}

export async function loadQuotationOverview(period: Period) {
  const { previous, bucket, args } = periodArgs(period)
  const [kpiRows, wonRows, pipe, expiring, customers, series] = await Promise.all([
    queryMany<Row>(QUOTATION_SQL.kpis, args),
    queryMany<Row>(QUOTATION_SQL.won, args),
    queryOne<Row>(QUOTATION_SQL.pipeline),
    queryMany<Row>(QUOTATION_SQL.expiring),
    queryMany<Row>(QUOTATION_SQL.topCustomers, args),
    queryMany<Row>(QUOTATION_SQL.series(bucket), args),
  ])
  const pipeline = {
    open: num(pipe?.open),
    openValue: num(pipe?.open_value),
    expiring: num(pipe?.expiring),
    expiringValue: num(pipe?.expiring_value),
    lapsed: num(pipe?.lapsed),
    lapsedValue: num(pipe?.lapsed_value),
    staleDrafts: num(pipe?.stale_drafts),
  }
  return {
    period,
    previous,
    bucket,
    validDays: QUOTE_VALID_DAYS,
    kpis: byPeriod(kpiRows, quoteStats),
    won: byPeriod(wonRows, r => ({
      count: num(r?.won),
      value: num(r?.won_value),
      avgDaysToAccept: numOrNull(r?.avg_days),
    })),
    pipeline,
    expiring: expiring.map(r => ({
      id: str(r.id),
      number: str(r.quote_number),
      customer: str(r.customer),
      amount: num(r.total_amount),
      date: str(r.quote_date),
      daysLeft: num(r.days_left),
      href: `/admin/quotations/${str(r.id)}/view`,
    })),
    topCustomers: customers.map(r => ({
      name: str(r.customer),
      quotes: num(r.quotes),
      quoted: num(r.quoted),
      accepted: num(r.accepted),
      acceptedValue: num(r.accepted_value),
    })),
    series: series.map(r => ({
      label: str(r.label),
      sent: num(r.sent),
      sentValue: num(r.sent_value),
      accepted: num(r.accepted),
    })),
    attention: quotationAttention(pipeline),
  }
}

export type QuotationOverview = Awaited<ReturnType<typeof loadQuotationOverview>>
