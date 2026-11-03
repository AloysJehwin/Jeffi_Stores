import { gunzipSync } from 'zlib'
import { queryMany, queryOne } from '@/lib/shared/db'
import { resolveAmazonCreds } from '@/lib/integrations/resolve'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { istDate } from '@/lib/channels/report-store'
import { spApiRequest } from './client'

// Reports API 2021-06-30: Sales and Traffic (daily and by child ASIN, last 30 days) and the V2
// settlement reports Amazon creates for each payout. Reports take minutes, so a run collects what
// finished since the last run and requests what is missing; nothing waits inside one run.

export const SALES_TRAFFIC = 'GET_SALES_AND_TRAFFIC_REPORT'
export const SETTLEMENT = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'
const REPORT_DAYS = 30

export async function createReport(reportType: string, start: string, end: string, options?: Record<string, string>): Promise<string> {
  const creds = await resolveAmazonCreds()
  const res = await spApiRequest('POST', '/reports/2021-06-30/reports', {
    body: { reportType, marketplaceIds: [creds.marketplaceId], dataStartTime: `${start}T00:00:00+05:30`, dataEndTime: `${end}T23:59:59+05:30`, ...(options ? { reportOptions: options } : {}) },
  })
  if (!res?.reportId) throw new Error('Amazon returned no report id')
  return String(res.reportId)
}

export async function getReport(reportId: string): Promise<{ processingStatus: string; reportDocumentId?: string }> {
  return spApiRequest('GET', `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`)
}

export async function downloadDocument(documentId: string): Promise<string> {
  const doc = await spApiRequest('GET', `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`)
  if (!doc?.url) throw new Error('Amazon returned no document link')
  const res = await fetch(doc.url)
  if (!res.ok) throw new Error(`Report download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  return (doc.compressionAlgorithm === 'GZIP' ? gunzipSync(buf) : buf).toString('utf8')
}

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
const money = (m: any) => n(m?.amount ?? m?.Amount)

export function mapSalesTraffic(json: any) {
  const daily = (json?.salesAndTrafficByDate ?? []).map((d: any) => [
    d.date,
    money(d.salesByDate?.orderedProductSales),
    n(d.salesByDate?.unitsOrdered),
    n(d.salesByDate?.totalOrderItems),
    n(d.salesByDate?.unitsRefunded),
    n(d.trafficByDate?.sessions),
    n(d.trafficByDate?.pageViews),
    d.trafficByDate?.buyBoxPercentage ?? null,
    d.trafficByDate?.unitSessionPercentage ?? null,
  ])
  const byAsin = (json?.salesAndTrafficByAsin ?? []).map((a: any) => ({
    asin: String(a.childAsin ?? a.parentAsin ?? ''),
    sku: a.sku ?? null,
    sales: money(a.salesByAsin?.orderedProductSales),
    units: n(a.salesByAsin?.unitsOrdered),
    sessions: n(a.trafficByAsin?.sessions),
    pageViews: n(a.trafficByAsin?.pageViews),
    buyBox: a.trafficByAsin?.buyBoxPercentage ?? null,
    unitSession: a.trafficByAsin?.unitSessionPercentage ?? null,
  }))
  return { daily, byAsin: byAsin.filter((a: any) => a.asin) }
}

export interface Settlement {
  settlementId: string
  start: string | null
  end: string | null
  deposit: string | null
  total: number | null
  currency: string
  productSales: number
  fees: number
  refunds: number
  taxWithheld: number
  other: number
  breakdown: Record<string, number>
}

/** Tab-separated V2 settlement report: the first data row carries the totals; every row has an
 * amount with its type and description, summed into sales, fees, refunds, TCS/TDS and the rest. */
export function parseSettlement(tsv: string): Settlement | null {
  const lines = tsv.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return null
  const head = lines[0].split('\t').map(h => h.trim().toLowerCase())
  const col = (row: string[], name: string) => row[head.indexOf(name)] ?? ''
  const rows = lines.slice(1).map(l => l.split('\t'))
  const first = rows[0]
  const out: Settlement = {
    settlementId: col(first, 'settlement-id'),
    start: col(first, 'settlement-start-date') || null,
    end: col(first, 'settlement-end-date') || null,
    deposit: col(first, 'deposit-date') || null,
    total: col(first, 'total-amount') === '' ? null : n(col(first, 'total-amount')),
    currency: col(first, 'currency') || 'INR',
    productSales: 0,
    fees: 0,
    refunds: 0,
    taxWithheld: 0,
    other: 0,
    breakdown: {},
  }
  if (!out.settlementId) return null
  for (const r of rows.slice(1)) {
    const amount = n(col(r, 'amount'))
    if (!amount) continue
    const type = col(r, 'amount-type')
    const desc = col(r, 'amount-description')
    const tx = col(r, 'transaction-type')
    const key = `${type}: ${desc}`.trim()
    out.breakdown[key] = Math.round(((out.breakdown[key] ?? 0) + amount) * 100) / 100
    if (/refund/i.test(tx)) out.refunds += amount
    else if (/tcs|tds|withheld/i.test(`${type} ${desc}`)) out.taxWithheld += amount
    else if (/fee|commission/i.test(`${type} ${desc}`)) out.fees += amount
    else if (/^ItemPrice$/i.test(type) && /principal|tax/i.test(desc)) out.productSales += amount
    else out.other += amount
  }
  for (const k of ['productSales', 'fees', 'refunds', 'taxWithheld', 'other'] as const) out[k] = Math.round(out[k] * 100) / 100
  return out
}

async function collect(db: { query: (s: string, p?: any[]) => Promise<any> }, req: { report_id: string; report_type: string; data_start: string; data_end: string }): Promise<number> {
  const r = await getReport(req.report_id)
  if (r.processingStatus === 'IN_QUEUE' || r.processingStatus === 'IN_PROGRESS') return 0
  if (r.processingStatus !== 'DONE' || !r.reportDocumentId) {
    await db.query(`UPDATE amazon_report_requests SET status = 'failed', error = $2, collected_at = now() WHERE report_id = $1`, [req.report_id, r.processingStatus])
    return 0
  }
  const body = await downloadDocument(r.reportDocumentId)
  const { daily, byAsin } = mapSalesTraffic(JSON.parse(body))
  await db.query('BEGIN')
  try {
    for (const d of daily) {
      await db.query(
        `INSERT INTO amazon_sales_traffic_daily (date, ordered_sales, units_ordered, order_items, units_refunded, sessions, page_views, buy_box_pct, unit_session_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (date) DO UPDATE SET ordered_sales=EXCLUDED.ordered_sales, units_ordered=EXCLUDED.units_ordered, order_items=EXCLUDED.order_items,
           units_refunded=EXCLUDED.units_refunded, sessions=EXCLUDED.sessions, page_views=EXCLUDED.page_views, buy_box_pct=EXCLUDED.buy_box_pct, unit_session_pct=EXCLUDED.unit_session_pct`,
        d
      )
    }
    await db.query(`DELETE FROM amazon_sales_traffic_asin`)
    for (const a of byAsin) {
      await db.query(
        `INSERT INTO amazon_sales_traffic_asin (asin, sku, data_start, data_end, ordered_sales, units_ordered, sessions, page_views, buy_box_pct, unit_session_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (asin) DO NOTHING`,
        [a.asin, a.sku, req.data_start, req.data_end, a.sales, a.units, a.sessions, a.pageViews, a.buyBox, a.unitSession]
      )
    }
    await db.query(`UPDATE amazon_report_requests SET status = 'done', collected_at = now() WHERE report_id = $1`, [req.report_id])
    await db.query('COMMIT')
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
  return daily.length
}

export async function runAmazonReports(now = new Date()): Promise<RunResult> {
  return withChannelLock('amazon', 'amazon_reports', 'reports', async ({ db, step }) => {
    const pending = await queryMany<any>(
      `SELECT report_id, report_type, data_start::text, data_end::text FROM amazon_report_requests WHERE status = 'requested' ORDER BY requested_at`
    )
    for (const p of pending) await step('sales_traffic_days', () => collect(db, p))
    await step('requested', async () => {
      const fresh = await queryOne(
        `SELECT 1 FROM amazon_report_requests WHERE report_type = $1 AND (status = 'requested' OR requested_at > now() - interval '20 hours') LIMIT 1`,
        [SALES_TRAFFIC]
      )
      if (fresh) return 0
      const start = istDate(now, REPORT_DAYS)
      const end = istDate(now, 2) // Amazon finalises sales and traffic about two days late
      const id = await createReport(SALES_TRAFFIC, start, end, { dateGranularity: 'DAY', asinGranularity: 'CHILD' })
      await db.query(`INSERT INTO amazon_report_requests (report_id, report_type, data_start, data_end) VALUES ($1,$2,$3,$4)`, [id, SALES_TRAFFIC, start, end])
      return 1
    })
    await step('settlements', async () => {
      const res = await spApiRequest('GET', '/reports/2021-06-30/reports', {
        query: { reportTypes: SETTLEMENT, processingStatuses: 'DONE', pageSize: '20' },
      })
      let n = 0
      for (const r of res?.reports ?? []) {
        if (!r.reportDocumentId) continue
        const seen = await queryOne(`SELECT 1 FROM amazon_report_requests WHERE report_id = $1`, [String(r.reportId)])
        if (seen) continue
        const s = parseSettlement(await downloadDocument(String(r.reportDocumentId)))
        if (s) {
          await db.query(
            `INSERT INTO amazon_settlements (settlement_id, start_date, end_date, deposit_date, total_amount, currency, product_sales, fees, refunds, tax_withheld, other, breakdown)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
             ON CONFLICT (settlement_id) DO UPDATE SET deposit_date=EXCLUDED.deposit_date, total_amount=EXCLUDED.total_amount, product_sales=EXCLUDED.product_sales,
               fees=EXCLUDED.fees, refunds=EXCLUDED.refunds, tax_withheld=EXCLUDED.tax_withheld, other=EXCLUDED.other, breakdown=EXCLUDED.breakdown`,
            [s.settlementId, s.start, s.end, s.deposit, s.total, s.currency, s.productSales, s.fees, s.refunds, s.taxWithheld, s.other, JSON.stringify(s.breakdown)]
          )
          n++
        }
        await db.query(`INSERT INTO amazon_report_requests (report_id, report_type, status, collected_at) VALUES ($1, $2, 'done', now()) ON CONFLICT DO NOTHING`, [
          String(r.reportId),
          SETTLEMENT,
        ])
      }
      return n
    })
  })
}

/** Sales tab: Amazon's sales and traffic, settlements, and an estimated profit from imported orders. */
export async function loadAmazonSales() {
  const [daily, asins, settlements, profit] = await Promise.all([
    queryMany<any>(`SELECT * FROM amazon_sales_traffic_daily WHERE date > current_date - 45 ORDER BY date`),
    queryMany<any>(
      `SELECT a.*, l.title FROM amazon_sales_traffic_asin a LEFT JOIN amazon_listing_status l ON l.asin = a.asin ORDER BY a.ordered_sales DESC LIMIT 500`
    ),
    queryMany<any>(`SELECT * FROM amazon_settlements ORDER BY end_date DESC NULLS LAST LIMIT 24`),
    queryOne<any>(
      `WITH cat AS (
         SELECT COALESCE(v.sku, p.sku) AS sku, COALESCE(v.cost_price, p.cost_price) AS cost FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
       )
       SELECT COALESCE(SUM(i.item_price - COALESCE(i.item_tax, 0)), 0) AS revenue_ex_tax,
              COALESCE(SUM(i.quantity * cat.cost), 0) AS cost,
              COALESCE(SUM(i.quantity * f.total_fees), 0) AS fees,
              count(*) FILTER (WHERE cat.cost IS NULL) AS lines_without_cost,
              count(*) AS lines
         FROM amazon_order_items i JOIN amazon_orders a ON a.amazon_order_id = i.amazon_order_id
         LEFT JOIN cat ON cat.sku = i.sku LEFT JOIN amazon_fee_estimates f ON f.sku = i.sku
        WHERE a.purchase_date > now() - interval '30 days' AND a.status <> 'Canceled'`
    ),
  ])
  const p = profit ?? {}
  const revenue = Number(p.revenue_ex_tax ?? 0)
  const cost = Number(p.cost ?? 0)
  const fees = Number(p.fees ?? 0)
  return {
    daily,
    asins,
    settlements,
    profit: { revenue, cost, fees, profit: revenue - cost - fees, linesWithoutCost: Number(p.lines_without_cost ?? 0), lines: Number(p.lines ?? 0) },
  }
}
