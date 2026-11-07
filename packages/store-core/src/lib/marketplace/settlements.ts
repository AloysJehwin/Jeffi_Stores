import { createHash } from 'crypto'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { readSetting, writeSettings } from '@/lib/google-ads/notify'
import type { MarketplaceAdapter, SettlementRow } from './adapter'
import { cellText, parseAmount, parseDate, suggestColumns, type SheetData } from './sheet'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Settlement reports (uploaded until the marketplaces offer an API): a saved column mapping turns
// each report row into a settlement line, lines are grouped into payouts by settlement reference
// (or by settlement date when the report has none) and matched to our marketplace orders.
// Re-importing a payout replaces its lines. Receivable = delivered orders with nothing settled.

export type SettlementField =
  | 'settlement_ref'
  | 'order_id'
  | 'line_id'
  | 'settled_on'
  | 'line_type'
  | 'description'
  | 'gross'
  | 'commission'
  | 'fees'
  | 'tax_withheld'
  | 'net'

export const SETTLEMENT_FIELDS: { key: SettlementField; label: string; multiple?: boolean; hint?: string }[] = [
  { key: 'settlement_ref', label: 'Settlement / UTR reference', hint: 'Rows are grouped by settlement date when there is none' },
  { key: 'order_id', label: 'Order ID' },
  { key: 'line_id', label: 'Order line ID' },
  { key: 'settled_on', label: 'Settlement date' },
  { key: 'line_type', label: 'Transaction type' },
  { key: 'description', label: 'Description' },
  { key: 'gross', label: 'Sale amount', multiple: true },
  { key: 'commission', label: 'Commission', multiple: true },
  { key: 'fees', label: 'Fees (logistics, fixed, gateway)', multiple: true },
  { key: 'tax_withheld', label: 'TCS / TDS', multiple: true },
  { key: 'net', label: 'Net settled', hint: 'Worked out as sale minus commission, fees and tax when blank' },
]

export type SettlementMapping = Partial<Record<SettlementField, string | string[]>>

const COMMON: Record<SettlementField, string[]> = {
  settlement_ref: ['settlement id', 'settlement ref', 'settlement reference', 'settlement no', 'utr', 'utr no', 'utr number', 'payment reference', 'neft reference', 'bank reference', 'payout id', 'remittance id'],
  order_id: ['order id', 'order no', 'order number', 'seller order id'],
  line_id: ['order line id', 'line id', 'sub order id', 'suborder id', 'order item id', 'item id'],
  settled_on: ['settlement date', 'payment date', 'value date', 'payout date', 'remittance date', 'paid on', 'utr date', 'date'],
  line_type: ['transaction type', 'type', 'particulars', 'nature'],
  description: ['description', 'remarks', 'narration'],
  gross: ['customer paid amount', 'sale amount', 'gross amount', 'order value', 'invoice amount', 'item value', 'total sale value', 'selling price'],
  commission: ['total commission', 'marketplace commission', 'commission amount', 'commission'],
  fees: ['total fees', 'logistics fee', 'shipping fee', 'fixed fee', 'collection fee', 'payment gateway fee', 'fees'],
  tax_withheld: ['tcs', 'tcs amount', 'tds', 'tds amount', 'tax withheld'],
  net: ['net payable', 'net settlement amount', 'seller payout', 'payout amount', 'settled amount', 'amount settled', 'net amount', 'final payable', 'net receivable', 'bank settlement value'],
}

export const SETTLEMENT_SYNONYMS: Record<MarketplaceChannel, Record<SettlementField, string[]>> = {
  myntra: { ...COMMON, order_id: ['order release id', 'store order id', ...COMMON.order_id], line_id: ['order line id', 'packet id', ...COMMON.line_id] },
  ajio: { ...COMMON, order_id: ['cust order no', 'customer order number', 'customer order no', ...COMMON.order_id], line_id: ['shipment id', ...COMMON.line_id] },
}

export function suggestSettlementColumns(channel: MarketplaceChannel, headers: string[]): SettlementMapping {
  return suggestColumns(headers, SETTLEMENT_SYNONYMS[channel])
}

const cols = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : [])

/** The mapping needs an amount (sale or net); every mapped column must be in the file. */
export function mappingErrors(mapping: SettlementMapping, headers: string[]): string[] {
  const out: string[] = []
  if (!cols(mapping.net).length && !cols(mapping.gross).length) out.push('Map the net settled amount or the sale amount.')
  const missing = Object.values(mapping).flatMap(cols).filter(c => !headers.includes(c))
  if (missing.length) out.push(`These columns are not in the file: ${[...new Set(missing)].slice(0, 5).join(', ')}.`)
  return out
}

export function classifyLine(text: string | null, gross: number, net: number, hasCharges: boolean): SettlementRow['lineType'] {
  const t = (text ?? '').toLowerCase()
  if (t) {
    if (/refund|return|rto|reversal|cancel/.test(t)) return 'refund'
    if (/commission/.test(t)) return 'commission'
    if (/\btcs\b|\btds\b|\btax\b|gst/.test(t)) return 'tax'
    if (/fee|logistic|shipping|charge/.test(t)) return 'fee'
    if (/adjust|claim|penalt|incentive|compensation/.test(t)) return 'adjustment'
    if (/sale|order|forward|payment|settle/.test(t)) return 'sale'
  }
  if (gross < 0 || (gross === 0 && net < 0 && !hasCharges)) return 'refund'
  if (gross === 0 && hasCharges) return 'fee'
  return gross === 0 && net === 0 ? 'other' : 'sale'
}

export interface NormalizedLine extends SettlementRow {
  rowNumber: number
  description: string | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const TOTAL_RE = /^(grand\s+)?totals?$/i

/** Report rows to settlement lines. `fallbackRef` names the payout when the report has no reference. */
export function normalizeSettlementRows(
  sheet: SheetData,
  mapping: SettlementMapping,
  fallbackRef: (settledOn: string | null) => string
): { lines: NormalizedLine[]; errors: { row: number; message: string }[] } {
  const lines: NormalizedLine[] = []
  const errors: { row: number; message: string }[] = []
  const sum = (row: Record<string, unknown>, field: SettlementField) => {
    const list = cols(mapping[field])
    let total = 0
    let found = false
    for (const c of list) {
      const v = parseAmount(row[c])
      if (v != null) {
        total += v
        found = true
      }
    }
    return { total, found }
  }
  const one = (row: Record<string, unknown>, field: SettlementField) => {
    const c = cols(mapping[field])[0]
    return c ? row[c] : null
  }
  sheet.rows.forEach((row, i) => {
    const rowNumber = i + 2
    const orderId = cellText(one(row, 'order_id'))
    if (!orderId && Object.values(row).some(v => typeof v === 'string' && TOTAL_RE.test(v.trim()))) return
    const gross = sum(row, 'gross')
    const commission = Math.abs(sum(row, 'commission').total)
    const fees = Math.abs(sum(row, 'fees').total)
    const tax = Math.abs(sum(row, 'tax_withheld').total)
    const netCell = sum(row, 'net')
    if (!gross.found && !netCell.found) {
      if (orderId) errors.push({ row: rowNumber, message: `No amount for order ${orderId}` })
      return
    }
    const net = netCell.found ? netCell.total : gross.total - commission - fees - tax
    const settledOn = parseDate(one(row, 'settled_on'))
    if (cols(mapping.settled_on).length && one(row, 'settled_on') != null && !settledOn) errors.push({ row: rowNumber, message: `Unreadable date "${cellText(one(row, 'settled_on'))}"` })
    const typeText = cellText(one(row, 'line_type')) ?? cellText(one(row, 'description'))
    lines.push({
      rowNumber,
      settlementRef: (cellText(one(row, 'settlement_ref')) ?? fallbackRef(settledOn)).slice(0, 120),
      externalOrderId: orderId?.slice(0, 120) ?? null,
      externalLineId: cellText(one(row, 'line_id'))?.slice(0, 120) ?? null,
      lineType: classifyLine(typeText, gross.total, net, commission + fees + tax > 0),
      gross: r2(gross.total),
      commission: r2(commission),
      fees: r2(fees),
      taxWithheld: r2(tax),
      net: r2(net),
      postedOn: settledOn,
      description: cellText(one(row, 'description'))?.slice(0, 300) ?? null,
      raw: row,
    })
  })
  return { lines, errors }
}

export interface PayoutTotals {
  ref: string
  lines: number
  gross: number
  commission: number
  fees: number
  taxWithheld: number
  refunds: number
  adjustments: number
  net: number
  periodStart: string | null
  periodEnd: string | null
}

export function groupPayouts(lines: SettlementRow[]): PayoutTotals[] {
  const by = new Map<string, PayoutTotals>()
  for (const l of lines) {
    const p = by.get(l.settlementRef) ?? { ref: l.settlementRef, lines: 0, gross: 0, commission: 0, fees: 0, taxWithheld: 0, refunds: 0, adjustments: 0, net: 0, periodStart: null, periodEnd: null }
    p.lines++
    if (l.lineType === 'refund') p.refunds += Math.abs(l.gross || l.net)
    else if (l.lineType === 'adjustment' || l.lineType === 'other') p.adjustments += l.net
    else p.gross += l.gross
    p.commission += l.commission
    p.fees += l.fees
    p.taxWithheld += l.taxWithheld
    p.net += l.net
    if (l.postedOn) {
      if (!p.periodStart || l.postedOn < p.periodStart) p.periodStart = l.postedOn
      if (!p.periodEnd || l.postedOn > p.periodEnd) p.periodEnd = l.postedOn
    }
    by.set(l.settlementRef, p)
  }
  return [...by.values()].map(p => ({
    ...p,
    gross: r2(p.gross),
    commission: r2(p.commission),
    fees: r2(p.fees),
    taxWithheld: r2(p.taxWithheld),
    refunds: r2(p.refunds),
    adjustments: r2(p.adjustments),
    net: r2(p.net),
  }))
}

export const fileRef = (buf: Buffer) => (settledOn: string | null) => `UPLOAD-${createHash('sha1').update(buf).digest('hex').slice(0, 10)}-${settledOn ?? 'undated'}`

// ── Saved column mapping ────────────────────────────────────────────────────

const mappingKey = (channel: MarketplaceChannel) => `${channel}_settlement_columns`

export async function savedSettlementMapping(channel: MarketplaceChannel): Promise<SettlementMapping | null> {
  try {
    const raw = JSON.parse((await readSetting(mappingKey(channel))) ?? 'null')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  } catch {
    return null
  }
}

export async function saveSettlementMapping(channel: MarketplaceChannel, mapping: SettlementMapping): Promise<void> {
  const clean: SettlementMapping = {}
  for (const f of SETTLEMENT_FIELDS) {
    const list = cols(mapping[f.key]).map(c => String(c).slice(0, 200)).slice(0, f.multiple ? 8 : 1)
    if (list.length) clean[f.key] = f.multiple ? list : list[0]
  }
  await writeSettings({ [mappingKey(channel)]: JSON.stringify(clean) })
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportOutcome {
  settlements: number
  lines: number
  matched: number
}

/** Writes the payouts and their lines (replacing lines of a payout imported before). */
export async function importSettlementLines(
  channel: MarketplaceChannel,
  lines: SettlementRow[],
  meta: { fileName?: string | null; source: 'upload' | 'api' }
): Promise<ImportOutcome> {
  const payouts = groupPayouts(lines)
  let matched = 0
  await withTransaction(async db => {
    for (const p of payouts) {
      const s = await db.query<{ id: string }>(
        `INSERT INTO marketplace_settlements (channel, settlement_ref, period_start, period_end, settled_on, gross, commission, fees, tax_withheld,
           refunds, adjustments, net_amount, source, file_name, breakdown, imported_at)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
         ON CONFLICT (channel, settlement_ref) DO UPDATE SET period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
           settled_on = EXCLUDED.settled_on, gross = EXCLUDED.gross, commission = EXCLUDED.commission, fees = EXCLUDED.fees,
           tax_withheld = EXCLUDED.tax_withheld, refunds = EXCLUDED.refunds, adjustments = EXCLUDED.adjustments, net_amount = EXCLUDED.net_amount,
           source = EXCLUDED.source, file_name = EXCLUDED.file_name, breakdown = EXCLUDED.breakdown, imported_at = now()
         RETURNING id`,
        [channel, p.ref, p.periodStart, p.periodEnd, p.gross, p.commission, p.fees, p.taxWithheld, p.refunds, p.adjustments, p.net, meta.source, meta.fileName?.slice(0, 200) ?? null, JSON.stringify({ lines: p.lines })]
      )
      const id = s.rows[0].id
      await db.query(`DELETE FROM marketplace_settlement_lines WHERE settlement_id = $1`, [id])
      const mine = lines.filter(l => l.settlementRef === p.ref)
      const res = await db.query<{ matched: string }>(
        `WITH ins AS (
           INSERT INTO marketplace_settlement_lines (settlement_id, channel, external_order_id, external_line_id, marketplace_order_id, order_id,
             line_type, description, gross, commission, fees, tax_withheld, net_amount, posted_on, raw)
           SELECT $1, $2, r.order_id, r.line_id, COALESCE(a.id, b.id), COALESCE(a.order_id, b.order_id), r.line_type, r.description, r.gross, r.commission,
                  r.fees, r.tax, r.net, r.posted_on, COALESCE(r.raw, '{}'::jsonb)
             FROM jsonb_to_recordset($3::jsonb) AS r(order_id text, line_id text, line_type text, description text, gross numeric, commission numeric,
                  fees numeric, tax numeric, net numeric, posted_on date, raw jsonb)
             LEFT JOIN marketplace_orders a ON a.channel = $2 AND a.external_order_id = r.order_id
             LEFT JOIN LATERAL (
               SELECT i.marketplace_order_id FROM marketplace_order_items i
                WHERE a.id IS NULL AND r.line_id IS NOT NULL AND i.channel = $2 AND i.external_line_id = r.line_id LIMIT 1
             ) li ON true
             LEFT JOIN marketplace_orders b ON b.id = li.marketplace_order_id
           RETURNING marketplace_order_id
         )
         SELECT count(*) FILTER (WHERE marketplace_order_id IS NOT NULL) AS matched FROM ins`,
        [
          id,
          channel,
          JSON.stringify(
            mine.map(l => ({
              order_id: l.externalOrderId ?? null,
              line_id: l.externalLineId ?? null,
              line_type: l.lineType,
              description: (l as NormalizedLine).description ?? null,
              gross: l.gross,
              commission: l.commission,
              fees: l.fees,
              tax: l.taxWithheld,
              net: l.net,
              posted_on: l.postedOn ?? null,
              raw: l.raw ?? null,
            }))
          ),
        ]
      )
      matched += Number(res.rows[0]?.matched ?? 0)
    }
  })
  return { settlements: payouts.length, lines: lines.length, matched }
}

/** For when a marketplace ships a settlements API: pull a range through the adapter and import it. */
export async function pullSettlements(channel: MarketplaceChannel, adapter: MarketplaceAdapter, range: { from: string; to: string }): Promise<ImportOutcome | null> {
  if (!adapter.settlements) return null
  const rows = await adapter.settlements(range)
  return rows.length ? importSettlementLines(channel, rows, { source: 'api' }) : { settlements: 0, lines: 0, matched: 0 }
}

// ── Views ───────────────────────────────────────────────────────────────────

export const UNSETTLED_AFTER_DAYS = 20

export interface Receivable {
  deliveredOrders: number
  deliveredValue: number
  unsettledOrders: number
  unsettledValue: number
  overdueOrders: number
  overdueValue: number
  oldestUnsettledAt: string | null
}

const RECEIVABLE_SQL = `
  WITH d AS (
    SELECT mo.id, mo.external_order_id, COALESCE(mo.order_total, 0) AS total, COALESCE(o.delivered_at, mo.event_at, mo.updated_at) AS delivered_at, o.order_number,
           EXISTS (SELECT 1 FROM marketplace_settlement_lines sl WHERE sl.marketplace_order_id = mo.id) AS settled
      FROM marketplace_orders mo LEFT JOIN orders o ON o.id = mo.order_id
     WHERE mo.channel = $1 AND mo.status = 'delivered'
  )`

const n = (v: unknown) => Number(v ?? 0) || 0

export async function receivableFor(channel: MarketplaceChannel, days = UNSETTLED_AFTER_DAYS): Promise<Receivable> {
  const r = await queryOne<any>(
    `${RECEIVABLE_SQL}
     SELECT count(*) AS delivered, COALESCE(SUM(total), 0) AS delivered_value,
            count(*) FILTER (WHERE NOT settled) AS unsettled, COALESCE(SUM(total) FILTER (WHERE NOT settled), 0) AS unsettled_value,
            count(*) FILTER (WHERE NOT settled AND delivered_at < now() - ($2::int * interval '1 day')) AS overdue,
            COALESCE(SUM(total) FILTER (WHERE NOT settled AND delivered_at < now() - ($2::int * interval '1 day')), 0) AS overdue_value,
            MIN(delivered_at) FILTER (WHERE NOT settled) AS oldest
       FROM d`,
    [channel, days]
  ).catch(() => null)
  return {
    deliveredOrders: n(r?.delivered),
    deliveredValue: n(r?.delivered_value),
    unsettledOrders: n(r?.unsettled),
    unsettledValue: n(r?.unsettled_value),
    overdueOrders: n(r?.overdue),
    overdueValue: n(r?.overdue_value),
    oldestUnsettledAt: r?.oldest ? new Date(r.oldest).toISOString() : null,
  }
}

export interface SettlementListRow {
  id: string
  settlement_ref: string
  settled_on: string | null
  period_start: string | null
  period_end: string | null
  gross: number
  commission: number
  fees: number
  tax_withheld: number
  refunds: number
  net_amount: number
  source: string
  file_name: string | null
  lines: number
  matched: number
}

export interface UnsettledOrder {
  external_order_id: string
  order_number: string | null
  total: number
  delivered_at: string | null
}

export interface ChannelSettlementsView {
  range: { from: string; to: string }
  totals: { count: number; gross: number; commission: number; fees: number; tax: number; refunds: number; net: number }
  receivable: Receivable
  settlements: SettlementListRow[]
  unsettled: UnsettledOrder[]
  mapping: SettlementMapping | null
}

export async function loadChannelSettlements(channel: MarketplaceChannel, range: { from: string; to: string }): Promise<ChannelSettlementsView> {
  const [rows, receivable, unsettled, mapping] = await Promise.all([
    queryMany<any>(
      `SELECT s.id, s.settlement_ref, s.settled_on, s.period_start, s.period_end, s.gross, s.commission, s.fees, s.tax_withheld, s.refunds, s.net_amount,
              s.source, s.file_name, count(l.id) AS lines, count(l.marketplace_order_id) AS matched
         FROM marketplace_settlements s LEFT JOIN marketplace_settlement_lines l ON l.settlement_id = s.id
        WHERE s.channel = $1 AND COALESCE(s.settled_on, s.imported_at::date) BETWEEN $2::date AND $3::date
        GROUP BY s.id ORDER BY COALESCE(s.settled_on, s.imported_at::date) DESC, s.imported_at DESC LIMIT 200`,
      [channel, range.from, range.to]
    ).catch(() => []),
    receivableFor(channel),
    queryMany<any>(
      `${RECEIVABLE_SQL} SELECT external_order_id, order_number, total, delivered_at FROM d WHERE NOT settled ORDER BY delivered_at LIMIT 50`,
      [channel]
    ).catch(() => []),
    savedSettlementMapping(channel),
  ])
  const settlements: SettlementListRow[] = rows.map((r: any) => ({
    ...r,
    gross: n(r.gross),
    commission: n(r.commission),
    fees: n(r.fees),
    tax_withheld: n(r.tax_withheld),
    refunds: n(r.refunds),
    net_amount: n(r.net_amount),
    lines: n(r.lines),
    matched: n(r.matched),
  }))
  const t = settlements.reduce(
    (a, s) => ({
      count: a.count + 1,
      gross: a.gross + s.gross,
      commission: a.commission + s.commission,
      fees: a.fees + s.fees,
      tax: a.tax + s.tax_withheld,
      refunds: a.refunds + s.refunds,
      net: a.net + s.net_amount,
    }),
    { count: 0, gross: 0, commission: 0, fees: 0, tax: 0, refunds: 0, net: 0 }
  )
  return {
    range,
    totals: t,
    receivable,
    settlements,
    unsettled: unsettled.map((u: any) => ({ ...u, total: n(u.total), delivered_at: u.delivered_at ? new Date(u.delivered_at).toISOString() : null })),
    mapping,
  }
}

// ── Financial: Myntra, AJIO and Amazon together ─────────────────────────────

export type SettlementChannel = MarketplaceChannel | 'amazon'

export interface ChannelSummary {
  channel: SettlementChannel
  label: string
  count: number
  gross: number
  charges: number
  tax: number
  refunds: number
  net: number
  lastSettledOn: string | null
  receivable: Receivable | null
}

export interface RecentSettlement {
  channel: SettlementChannel
  ref: string
  settled_on: string | null
  gross: number
  charges: number
  net: number
}

export interface MarketplaceSettlementsOverview {
  range: { from: string; to: string }
  channels: ChannelSummary[]
  recent: RecentSettlement[]
  totals: { net: number; charges: number; receivable: number; overdue: number }
}

export async function loadMarketplaceSettlementsOverview(range: { from: string; to: string }): Promise<MarketplaceSettlementsOverview> {
  const [ours, amazon, recentOurs, recentAmazon, myntraRec, ajioRec] = await Promise.all([
    queryMany<any>(
      `SELECT channel, count(*) AS count, SUM(gross) AS gross, SUM(commission + fees) AS charges, SUM(tax_withheld) AS tax, SUM(refunds) AS refunds,
              SUM(net_amount) AS net, MAX(settled_on) AS last
         FROM marketplace_settlements WHERE channel IN ('myntra', 'ajio') AND COALESCE(settled_on, imported_at::date) BETWEEN $1::date AND $2::date
        GROUP BY channel`,
      [range.from, range.to]
    ).catch(() => []),
    queryOne<any>(
      `SELECT count(*) AS count, SUM(product_sales) AS gross, SUM(ABS(fees)) AS charges, SUM(ABS(tax_withheld)) AS tax, SUM(ABS(refunds)) AS refunds,
              SUM(total_amount) AS net, MAX(COALESCE(deposit_date, end_date))::date AS last
         FROM amazon_settlements WHERE COALESCE(deposit_date, end_date)::date BETWEEN $1::date AND $2::date`,
      [range.from, range.to]
    ).catch(() => null),
    queryMany<any>(
      `SELECT channel, settlement_ref AS ref, settled_on, gross, commission + fees AS charges, net_amount AS net FROM marketplace_settlements
        WHERE channel IN ('myntra', 'ajio') AND COALESCE(settled_on, imported_at::date) BETWEEN $1::date AND $2::date
        ORDER BY settled_on DESC NULLS LAST LIMIT 30`,
      [range.from, range.to]
    ).catch(() => []),
    queryMany<any>(
      `SELECT 'amazon' AS channel, settlement_id AS ref, COALESCE(deposit_date, end_date)::date AS settled_on, product_sales AS gross, ABS(fees) AS charges,
              total_amount AS net FROM amazon_settlements WHERE COALESCE(deposit_date, end_date)::date BETWEEN $1::date AND $2::date
        ORDER BY COALESCE(deposit_date, end_date) DESC LIMIT 30`,
      [range.from, range.to]
    ).catch(() => []),
    receivableFor('myntra'),
    receivableFor('ajio'),
  ])
  const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null)
  const summary = (channel: SettlementChannel, label: string, r: any, receivable: Receivable | null): ChannelSummary => ({
    channel,
    label,
    count: n(r?.count),
    gross: n(r?.gross),
    charges: n(r?.charges),
    tax: n(r?.tax),
    refunds: n(r?.refunds),
    net: n(r?.net),
    lastSettledOn: day(r?.last),
    receivable,
  })
  const channels = [
    summary('myntra', CHANNEL_LABEL.myntra, ours.find((r: any) => r.channel === 'myntra'), myntraRec),
    summary('ajio', CHANNEL_LABEL.ajio, ours.find((r: any) => r.channel === 'ajio'), ajioRec),
    summary('amazon', 'Amazon', amazon, null),
  ]
  const recent = [...recentOurs, ...recentAmazon]
    .map((r: any) => ({ channel: r.channel, ref: r.ref, settled_on: day(r.settled_on), gross: n(r.gross), charges: n(r.charges), net: n(r.net) }))
    .sort((a, b) => (b.settled_on ?? '').localeCompare(a.settled_on ?? ''))
    .slice(0, 40)
  return {
    range,
    channels,
    recent,
    totals: {
      net: channels.reduce((s, c) => s + c.net, 0),
      charges: channels.reduce((s, c) => s + c.charges, 0),
      receivable: myntraRec.unsettledValue + ajioRec.unsettledValue,
      overdue: myntraRec.overdueOrders + ajioRec.overdueOrders,
    },
  }
}
