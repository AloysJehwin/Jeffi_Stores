import * as XLSX from 'xlsx'
import { queryMany, queryOne } from '@/lib/shared/db'
import { runChange, type ChangeOutcome } from '@/lib/channels/change-log'
import { withChannelLock } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { bulkInsert } from '@/lib/channels/report-store'
import type { ChangeActor } from '@/lib/channels/types'
import { kpis, type Kpis } from '@/lib/amazon-ads/console'
import {
  AD_FIELDS,
  adsChannelOf,
  autoMap,
  isKnownHeader,
  parseDate,
  parseNumber,
  reportKind,
  type AdField,
  type AdMapping,
  type AdsMarket,
} from './columns'
import { matchAdProducts, matchFor } from './match'
import { adsRuleSet } from './alerts'

// Report upload: read CSV/XLSX, map columns, preview (first 20 rows and the row errors), then
// commit. A commit replaces the channel's rows for the report's period in one transaction, under
// the import lock, so uploading the same report again leaves no duplicates.

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_ROWS = 50_000
export const PREVIEW_ROWS = 20

export class ReportError extends Error {
  status = 400
}

export interface RawReport {
  sheet: string
  headerRow: number
  headers: string[]
  rows: { line: number; cells: unknown[] }[]
}

const isBlankRow = (r: unknown[]) => r.every(v => v == null || String(v).trim() === '')

function workbook(buf: Buffer, fileName: string): XLSX.WorkBook {
  const zipOrOle = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)
  if (!zipOrOle || /\.(csv|tsv|txt)$/i.test(fileName)) {
    // Text: keep every cell a string so dd-mm-yyyy is not read as a US date.
    return XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true })
  }
  return XLSX.read(buf, { type: 'buffer' })
}

/** Find the sheet and header row (reports often have a title block above the table). */
export function readReport(buf: Buffer, fileName: string, market: AdsMarket): RawReport {
  if (!buf.length) throw new ReportError('The file is empty.')
  if (buf.length > MAX_BYTES) throw new ReportError('The file is larger than 10 MB. Download a shorter date range.')
  let wb: XLSX.WorkBook
  try {
    wb = workbook(buf, fileName)
  } catch {
    throw new ReportError('Could not read the file. Upload the report as .csv or .xlsx.')
  }
  let best: { sheet: string; aoa: unknown[][]; row: number; score: number } | null = null
  for (const sheet of wb.SheetNames.slice(0, 5)) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null, blankrows: true })
    for (let i = 0; i < Math.min(aoa.length, 25); i++) {
      const score = (aoa[i] ?? []).filter(c => isKnownHeader(market, c)).length
      if (score >= 2 && (!best || score > best.score)) best = { sheet, aoa, row: i, score }
    }
  }
  if (!best) {
    const sheet = wb.SheetNames[0]
    if (!sheet) throw new ReportError('The file has no sheets.')
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null, blankrows: true })
    const row = aoa.findIndex(r => !isBlankRow(r ?? []))
    if (row < 0) throw new ReportError('The file has no rows.')
    best = { sheet, aoa, row, score: 0 }
  }
  const seen = new Map<string, number>()
  const headers = (best.aoa[best.row] ?? []).map((h, i) => {
    const base = String(h ?? '').trim() || `Column ${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base} (${n})` : base
  })
  const rows: RawReport['rows'] = []
  for (let i = best.row + 1; i < best.aoa.length; i++) {
    const cells = best.aoa[i] ?? []
    if (isBlankRow(cells)) continue
    rows.push({ line: i + 1, cells })
    if (rows.length > MAX_ROWS) throw new ReportError(`The report has more than ${MAX_ROWS.toLocaleString('en-IN')} rows. Download a shorter date range.`)
  }
  return { sheet: best.sheet, headerRow: best.row + 1, headers, rows }
}

export interface NormRow {
  line: number
  date: string
  campaignKey: string
  campaignId: string | null
  campaignName: string | null
  adGroup: string
  productKey: string
  sku: string | null
  styleId: string | null
  productName: string | null
  impressions: number
  clicks: number
  spend: number
  orders: number
  units: number
  sales: number
}

export interface RowError {
  line: number
  message: string
}

const TOTAL = /^(grand\s+)?(sub\s*)?totals?:?$/i
const NUMERIC: AdField[] = ['impressions', 'clicks', 'spend', 'orders', 'units', 'sales']
const text = (v: unknown) => (v == null ? '' : String(v).trim())

/** Problems with the mapping itself (nothing can be imported until they are fixed). */
export function mappingProblems(m: AdMapping, opts: { period?: boolean } = {}): string[] {
  const out: string[] = []
  if (!m.spend) out.push('Map the Spend column.')
  if (reportKind(m) === 'campaign' && !m.campaign_id && !m.campaign_name) out.push('Map the campaign name or ID (or a SKU / style ID for a product report).')
  if (!m.date && !opts.period) out.push('Map the Date column, or pick the period this report covers.')
  return out
}

/** Mapped rows; a row with a problem is reported and left out. Summary rows (Total) are skipped. */
export function normalizeRows(report: RawReport, m: AdMapping, fallbackDate?: string | null): { rows: NormRow[]; errors: RowError[]; skipped: number } {
  const idx = Object.fromEntries(AD_FIELDS.map(f => [f.key, m[f.key] ? report.headers.indexOf(m[f.key]!) : -1])) as Record<AdField, number>
  const cell = (cells: unknown[], f: AdField) => (idx[f] >= 0 ? cells[idx[f]] : null)
  const kind = reportKind(m)
  const rows: NormRow[] = []
  const errors: RowError[] = []
  let skipped = 0
  for (const { line, cells } of report.rows) {
    const t = (f: AdField) => text(cell(cells, f))
    const labels = [t('campaign_name'), t('campaign_id'), t('sku'), t('style_id'), t('product_name'), t('date'), text(cells.find(c => text(c)))]
    if (labels.some(l => TOTAL.test(l))) {
      skipped++
      continue
    }
    const problems: string[] = []
    let date: string | null = null
    if (idx.date >= 0) {
      date = parseDate(cell(cells, 'date'))
      if (!date) problems.push(t('date') ? `date "${t('date')}" is not a date` : 'no date')
    } else date = fallbackDate ?? null
    const campaignId = t('campaign_id') || null
    const campaignName = t('campaign_name') || null
    const sku = t('sku') || null
    const styleId = t('style_id') || null
    if (kind === 'campaign' && !campaignId && !campaignName) problems.push('no campaign')
    if (kind === 'product' && !sku && !styleId) problems.push('no SKU or style ID')
    const nums = {} as Record<AdField, number>
    for (const f of NUMERIC) {
      const raw = cell(cells, f)
      const n = parseNumber(raw)
      if (n != null && Number.isNaN(n)) problems.push(`${AD_FIELDS.find(x => x.key === f)!.label.toLowerCase()} "${text(raw)}" is not a number`)
      else if (n != null && n < 0) problems.push(`${AD_FIELDS.find(x => x.key === f)!.label.toLowerCase()} is negative`)
      nums[f] = n == null || Number.isNaN(n) ? 0 : n
    }
    if (problems.length || !date) {
      errors.push({ line, message: problems.join('; ') || 'no date' })
      continue
    }
    rows.push({
      line,
      date,
      campaignKey: campaignId ?? campaignName ?? '',
      campaignId,
      campaignName,
      adGroup: t('ad_group'),
      productKey: sku ?? styleId ?? '',
      sku,
      styleId,
      productName: t('product_name') || null,
      impressions: Math.round(nums.impressions),
      clicks: Math.round(nums.clicks),
      spend: Math.round(nums.spend * 100) / 100,
      orders: Math.round(nums.orders),
      units: Math.round(nums.units),
      sales: Math.round(nums.sales * 100) / 100,
    })
  }
  return { rows, errors, skipped }
}

/** One row per table key: rows repeated in a report (e.g. per placement) are summed. */
export function aggregate(rows: NormRow[], kind: 'campaign' | 'product'): NormRow[] {
  const out = new Map<string, NormRow>()
  for (const r of rows) {
    const key = kind === 'campaign' ? `${r.date}|${r.campaignKey}|${r.adGroup}` : `${r.date}|${r.campaignKey}|${r.productKey}`
    const prev = out.get(key)
    if (!prev) {
      out.set(key, { ...r })
      continue
    }
    for (const f of ['impressions', 'clicks', 'orders', 'units'] as const) prev[f] += r[f]
    prev.spend = Math.round((prev.spend + r.spend) * 100) / 100
    prev.sales = Math.round((prev.sales + r.sales) * 100) / 100
    prev.campaignName ??= r.campaignName
    prev.productName ??= r.productName
    prev.sku ??= r.sku
    prev.styleId ??= r.styleId
  }
  return [...out.values()]
}

function dateSpan(rows: NormRow[]): { from: string; to: string } | null {
  if (!rows.length) return null
  let from = rows[0].date
  let to = rows[0].date
  for (const r of rows) {
    if (r.date < from) from = r.date
    if (r.date > to) to = r.date
  }
  return { from, to }
}

export function totalsOf(rows: NormRow[]): Kpis & { units: number } {
  const s = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 }
  for (const r of rows) {
    s.impressions += r.impressions
    s.clicks += r.clicks
    s.cost += r.spend
    s.sales += r.sales
    s.orders += r.orders
    s.units += r.units
  }
  return { ...kpis(s), units: s.units }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const tableOf = (kind: 'campaign' | 'product') => (kind === 'campaign' ? 'marketplace_ad_daily' : 'marketplace_ad_products')

/** The mapping to offer for a file: for each field, the most recent committed mapping whose header
 * is in this file (campaign and product reports keep their own headers this way). */
export async function savedMapping(market: AdsMarket, headers: string[]): Promise<AdMapping> {
  const recent = await queryMany<{ mapping: AdMapping }>(`SELECT mapping FROM marketplace_ad_imports WHERE channel = $1 ORDER BY imported_at DESC LIMIT 20`, [market]).catch(() => [])
  const out: AdMapping = {}
  for (const { mapping } of recent) {
    for (const f of AD_FIELDS) {
      const h = mapping?.[f.key]
      if (!out[f.key] && h && headers.includes(h)) out[f.key] = h
    }
  }
  return out
}

export interface ImportInput {
  market: AdsMarket
  buf: Buffer
  fileName: string
  /** Omitted on the first preview: the saved / suggested mapping is used. */
  mapping?: AdMapping | null
  /** The report's period; required when there is no date column, otherwise it may only widen it. */
  period?: { from?: string | null; to?: string | null } | null
}

export interface Prepared {
  report: RawReport
  mapping: AdMapping
  mappingSource: 'saved' | 'suggested' | 'given'
  kind: 'campaign' | 'product'
  rows: NormRow[]
  errors: RowError[]
  skipped: number
  range: { from: string; to: string } | null
  problems: string[]
}

export async function prepareImport(input: ImportInput): Promise<Prepared> {
  const report = readReport(input.buf, input.fileName, input.market)
  let mapping: AdMapping
  let mappingSource: Prepared['mappingSource'] = 'given'
  if (input.mapping) {
    mapping = Object.fromEntries(Object.entries(input.mapping).filter(([k, h]) => h && report.headers.includes(h) && AD_FIELDS.some(f => f.key === k))) as AdMapping
  } else {
    const saved = await savedMapping(input.market, report.headers)
    mapping = autoMap(report.headers, input.market, saved)
    mappingSource = Object.keys(saved).length ? 'saved' : 'suggested'
  }
  const kind = reportKind(mapping)
  const pFrom = input.period?.from && DATE.test(input.period.from) ? input.period.from : null
  const pTo = input.period?.to && DATE.test(input.period.to) ? input.period.to : null
  const problems = mappingProblems(mapping, { period: !!(pFrom && pTo) })
  if (pFrom && pTo && pFrom > pTo) problems.push('The period starts after it ends.')
  const { rows: valid, errors, skipped } = problems.length ? { rows: [], errors: [], skipped: 0 } : normalizeRows(report, mapping, mapping.date ? null : pTo)
  const span = dateSpan(valid)
  let range = span
  if (span && pFrom && pTo) range = { from: pFrom < span.from ? pFrom : span.from, to: pTo > span.to ? pTo : span.to }
  else if (!span && pFrom && pTo) range = { from: pFrom, to: pTo }
  return { report, mapping, mappingSource, kind, rows: valid, errors, skipped, range, problems }
}

export interface PreviewResult {
  fileName: string
  sheet: string
  headerRow: number
  headers: string[]
  samples: Record<string, string>
  mapping: AdMapping
  mappingSource: Prepared['mappingSource']
  kind: 'campaign' | 'product'
  problems: string[]
  rows: NormRow[]
  rowCount: number
  errors: RowError[]
  errorCount: number
  skipped: number
  range: { from: string; to: string } | null
  hasDate: boolean
  totals: Kpis & { units: number }
  existingRows: number
}

export async function previewImport(input: ImportInput): Promise<PreviewResult> {
  const p = await prepareImport(input)
  const samples: Record<string, string> = {}
  p.report.headers.forEach((h, i) => {
    const v = p.report.rows.find(r => text(r.cells[i]))?.cells[i]
    if (v != null) samples[h] = text(v).slice(0, 60)
  })
  const existing = p.range
    ? await queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${tableOf(p.kind)} WHERE channel = $1 AND date BETWEEN $2 AND $3`, [input.market, p.range.from, p.range.to]).catch(() => null)
    : null
  return {
    fileName: input.fileName,
    sheet: p.report.sheet,
    headerRow: p.report.headerRow,
    headers: p.report.headers,
    samples,
    mapping: p.mapping,
    mappingSource: p.mappingSource,
    kind: p.kind,
    problems: p.problems,
    rows: p.rows.slice(0, PREVIEW_ROWS),
    rowCount: p.rows.length,
    errors: p.errors.slice(0, 100),
    errorCount: p.errors.length,
    skipped: p.skipped,
    range: p.range,
    hasDate: !!p.mapping.date,
    totals: totalsOf(p.rows),
    existingRows: Number(existing?.n ?? 0),
  }
}

export interface CommitResult {
  importId: string | null
  kind: 'campaign' | 'product'
  rows: number
  replaced: number
  skipped: number
  range: { from: string; to: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate, then replace the channel's rows for the period. `allowErrors` imports the good rows
 * when some rows have problems (they are left out). */
export async function commitImport(input: ImportInput & { allowErrors?: boolean }, actor: ChangeActor): Promise<ChangeOutcome<CommitResult>> {
  const p = await prepareImport(input)
  const channel = adsChannelOf(input.market)
  const rows = aggregate(p.rows, p.kind)
  const range = p.range
  const table = tableOf(p.kind)
  const totals = totalsOf(rows)
  const outcome = await runChange<CommitResult>(
    {
      channel,
      action: 'report.import',
      entityType: `${p.kind}_report`,
      entityId: input.fileName.slice(0, 200),
      summary: range
        ? `Imported ${rows.length} ${p.kind} row${rows.length === 1 ? '' : 's'} from ${input.fileName} (${range.from} to ${range.to})`
        : `Import of ${input.fileName}`,
      after: { rows: rows.length, skipped: p.skipped, errors: p.errors.length, range, spend: totals.cost, sales: totals.sales },
      validate: () => [
        ...p.problems,
        ...(!p.problems.length && !rows.length ? ['The report has no rows to import.'] : []),
        ...(p.errors.length && !input.allowErrors ? [`${p.errors.length} row${p.errors.length === 1 ? ' has' : 's have'} problems. Fix the mapping or import the rest without them.`] : []),
      ],
      apply: async () => {
        let result: CommitResult | null = null
        const run = await withChannelLock(channel, `${input.market}_ads_import`, 'import', async ctx => {
          const db = ctx.db
          const matches = p.kind === 'product' ? await matchAdProducts(db, input.market, rows) : new Map()
          await db.query('BEGIN')
          try {
            const del = await db.query(`DELETE FROM ${table} WHERE channel = $1 AND date BETWEEN $2 AND $3`, [input.market, range!.from, range!.to])
            const imp = await db.query<{ id: string }>(
              `INSERT INTO marketplace_ad_imports (channel, kind, file_name, date_from, date_to, row_count, skipped_count, replaced_count, mapping, totals, imported_by, imported_by_email)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12) RETURNING id::text`,
              [
                input.market,
                p.kind,
                input.fileName.slice(0, 300),
                range!.from,
                range!.to,
                rows.length,
                p.skipped + p.errors.length,
                del.rowCount ?? 0,
                JSON.stringify(p.mapping),
                JSON.stringify(totals),
                actor.adminId && UUID.test(actor.adminId) ? actor.adminId : null,
                actor.email,
              ]
            )
            const importId = imp.rows[0]?.id ?? null
            const metrics = (r: NormRow) => [r.impressions, r.clicks, r.spend, r.orders, r.units, r.sales, importId]
            if (p.kind === 'campaign') {
              await bulkInsert(
                db,
                table,
                ['channel', 'date', 'campaign_key', 'campaign_id', 'campaign_name', 'ad_group', 'impressions', 'clicks', 'spend', 'orders', 'units', 'sales', 'import_id'],
                rows.map(r => [input.market, r.date, r.campaignKey, r.campaignId, r.campaignName, r.adGroup, ...metrics(r)])
              )
            } else {
              await bulkInsert(
                db,
                table,
                ['channel', 'date', 'campaign_key', 'campaign_name', 'product_key', 'sku', 'style_id', 'product_name', 'product_id', 'variant_id', 'sub_variant_id', 'impressions', 'clicks', 'spend', 'orders', 'units', 'sales', 'import_id'],
                rows.map(r => {
                  const m = matchFor(matches, r.sku, r.styleId)
                  return [input.market, r.date, r.campaignKey, r.campaignName, r.productKey, r.sku, r.styleId, r.productName, m?.product_id ?? null, m?.variant_id ?? null, m?.sub_variant_id ?? null, ...metrics(r)]
                })
              )
            }
            await db.query('COMMIT')
            ctx.counts.rows = rows.length
            ctx.counts.replaced = del.rowCount ?? 0
            result = { importId, kind: p.kind, rows: rows.length, replaced: del.rowCount ?? 0, skipped: p.skipped + p.errors.length, range: range! }
          } catch (e) {
            await db.query('ROLLBACK').catch(() => {})
            throw e
          }
        })
        if (run.status === 'error' || !result) throw new Error(run.errors[0]?.message || 'The import failed')
        return result
      },
    },
    actor,
    false
  )
  if (outcome.ok) await runChannelAlerts(adsRuleSet(channel))
  return outcome
}

export interface ImportRow {
  id: string
  kind: string
  file_name: string | null
  date_from: string
  date_to: string
  row_count: number
  skipped_count: number
  replaced_count: number
  totals: Record<string, number>
  imported_by_email: string | null
  imported_at: string
}

export async function listImports(market: AdsMarket, limit = 50): Promise<ImportRow[]> {
  return queryMany<ImportRow>(
    `SELECT id::text, kind, file_name, date_from::text, date_to::text, row_count, skipped_count, replaced_count, totals, imported_by_email, imported_at
       FROM marketplace_ad_imports WHERE channel = $1 ORDER BY imported_at DESC LIMIT $2`,
    [market, limit]
  ).catch(() => [])
}
