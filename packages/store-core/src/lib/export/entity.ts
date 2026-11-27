import 'server-only'
import { EXPORT_BATCH, exportQuery, joinFilterValues, normalizeQuery, paramNamesOf, searchParamOf, splitFilterValues, type FilterEntity, type FilterQuery } from '@jeffi/list-filters'
import { cappedCount, filterContext, withTimeout } from '@/lib/filters/run'
import { withDefaultWindow } from '@/lib/filters/window'
import type { ExportDefinition, ExportRow, ExportRunContext } from './define'
import type { ColumnType, DateRange, ExportColumn, ExportFilter, ExportScope, FilterValues } from './types'
import { narrowed } from './types'

// Export definitions for lists in the filter registry: the entity's export columns, its keyset
// batches and its filters, so the export holds exactly the rows the list shows. Page-specific
// include/exclude choices are the entity's own enum fields, intersected with the page's filters.

export interface EntityExportOverrides {
  title?: string
  noun?: string
  /** Per export-column tweaks: type, id, optional, total (null = never totalled), width, label. */
  columns?: Record<string, Partial<Omit<ExportColumn, 'key' | 'total'>> & { total?: ExportColumn['total'] | null }>
  /** Default column order (keys); the rest follow in entity order. */
  order?: string[]
  /** Entity enum fields offered as include/exclude choices (options come from the field). */
  include?: string[]
  /** Labels for the include choices when the field's own label reads oddly in an export. */
  includeLabels?: Record<string, string>
  scopes?: ExportScope[]
}

const EXPORT_TIMEOUT = '15s'

/** A type for a column the overrides don't describe, from its key and label. */
export function guessType(key: string, label: string): ColumnType {
  const k = `${key} ${label}`.toLowerCase()
  if (/(^|[ _])(date|day)([ _]|$)/.test(k) && !/(at|time)$/.test(key)) return 'date'
  if (/(_at$|created|updated|time|when|placed|sent|last_)/.test(key)) return 'datetime'
  if (/(price|amount|total|value|revenue|subtotal|discount|shipping|taxable|cgst|sgst|igst|tax|cost|balance|paid|due|spend|mrp|fee|refund|payout|credit|debit)/.test(k)) return 'money'
  if (/(rate|pct|percent|%)/.test(k)) return 'percent'
  if (/(qty|quantity|units|count|stock|orders|items|uses|views|clicks|impressions|rating)/.test(k)) return 'number'
  return 'text'
}

const SUMMED = /(total|amount|subtotal|discount|shipping|taxable|cgst|sgst|igst|tax|value|revenue|paid|due|refund|units|qty|quantity|balance|cost|spend|fee|payout|credit|debit)/i
const NOT_SUMMED = /(unit|price|rate|mrp|avg|average|per_|stock_value_per)/i

export function entityColumns(entity: FilterEntity, o: EntityExportOverrides = {}): ExportColumn[] {
  const src = entity.export?.columns ?? []
  const cols = src.map((c, i): ExportColumn => {
    const tweak = o.columns?.[c.key] ?? {}
    const type = tweak.type ?? guessType(c.key, c.label)
    const sumOk = (type === 'money' || type === 'number' || type === 'int') && SUMMED.test(c.key) && !NOT_SUMMED.test(c.key)
    return {
      key: c.key,
      label: tweak.label ?? c.label,
      type,
      id: tweak.id ?? i === 0,
      optional: tweak.optional,
      total: tweak.total === null ? undefined : (tweak.total ?? (sumOk ? 'sum' : undefined)),
      width: tweak.width ?? (i === 0 ? 1.3 : type === 'text' ? 1.2 : 1),
    }
  })
  if (!o.order?.length) return cols
  const rank = new Map(o.order.map((k, i) => [k, i]))
  return [...cols].sort((a, b) => (rank.get(a.key) ?? 1e6 + cols.indexOf(a)) - (rank.get(b.key) ?? 1e6 + cols.indexOf(b)))
}

export function entityFilters(entity: FilterEntity, o: EntityExportOverrides = {}): ExportFilter[] {
  if (entity.custom) return []
  const out: ExportFilter[] = []
  for (const key of o.include ?? []) {
    const f = entity.fields.find(x => x.key === key)
    const s = f ? entity.sql[f.key as keyof typeof entity.sql] : null
    if (!f || !s || s.kind !== 'enum' || !f.options?.length) continue
    out.push({ key: f.key, label: o.includeLabels?.[f.key] ?? f.label, kind: 'multi', options: f.options.map(x => ({ value: x.value, label: x.label })) })
  }
  return out
}

function periodParams(entity: FilterEntity): [string, string | undefined] | null {
  const field = entity.period ? entity.fields.find(f => f.key === entity.period) : undefined
  if (!field) return null
  const [from, to] = paramNamesOf(field)
  return [from, to]
}

export function entityRange(entity: FilterEntity, query: URLSearchParams): DateRange | undefined {
  const p = periodParams(entity)
  if (!p) return undefined
  const q = normalizeQuery(entity, query)
  const r: DateRange = {}
  if (q[p[0]]) r.from = q[p[0]]
  if (p[1] && q[p[1]]) r.to = q[p[1]]
  return r.from || r.to ? r : undefined
}

/**
 * The query the export runs: the page's filters (none for "everything"), the dialog's range in the
 * entity's period params, each narrowed include choice intersected with the page's own values.
 * Null when a choice leaves nothing to export.
 */
export function entityQuery(entity: FilterEntity, ctx: Pick<ExportRunContext, 'query' | 'scope' | 'range' | 'filters'>, filters: ExportFilter[]): FilterQuery | null {
  const sp = ctx.scope === 'all' ? new URLSearchParams() : new URLSearchParams(ctx.query)
  const p = periodParams(entity)
  if (p) {
    sp.delete(p[0])
    if (p[1]) sp.delete(p[1])
    if (ctx.range?.from) sp.set(p[0], ctx.range.from)
    if (ctx.range?.to && p[1]) sp.set(p[1], ctx.range.to)
  }
  for (const f of filters) {
    const picked = narrowed(f, ctx.filters as FilterValues)
    if (!picked) continue
    const name = paramNamesOf(entity.fields.find(x => x.key === f.key)!)[0]
    const current = splitFilterValues(sp.get(name), { commas: true })
    const next = current.length ? current.filter(v => picked.includes(v)) : picked
    if (!next.length) return null
    sp.set(name, joinFilterValues(next))
  }
  return withDefaultWindow(entity, normalizeQuery(entity, sp))
}

async function* entityBatches(entity: FilterEntity, q: FilterQuery, ids: string[] | null, cap: number): AsyncIterable<ExportRow[]> {
  const ex = entity.export!
  const ctx = await filterContext(entity, q)
  let after: unknown[] | undefined
  let rows = 0
  for (;;) {
    const limit = Math.min(EXPORT_BATCH, cap - rows)
    if (limit <= 0) return
    const eq = exportQuery(entity, q, { after, limit, ctx, ids: ids ?? undefined })
    if (!eq) return
    const batch = await withTimeout(entity.db, EXPORT_TIMEOUT, c => c.query<ExportRow>(eq.sql, eq.params).then(r => r.rows))
    if (!batch.length) return
    rows += batch.length
    const last = batch[batch.length - 1]
    after = ex.keyset.map((_, i) => last[`__k${i}`])
    yield batch
    if (batch.length < limit) return
  }
}

export function entityExport(entity: FilterEntity, o: EntityExportOverrides = {}): ExportDefinition {
  const filters = entityFilters(entity, o)
  const hasPeriod = !!periodParams(entity)
  return {
    key: entity.key,
    title: o.title ?? entity.noun,
    noun: o.noun ?? entity.noun,
    scope: entity.scope,
    exportScope: entity.exportScope,
    columns: entityColumns(entity, o),
    filters,
    scopes: o.scopes ?? ['filtered', 'page', 'selected', 'all'],
    dateRange: hasPeriod,
    rangeFromQuery: query => entityRange(entity, query),
    describe: ctx => (ctx.scope === 'all' ? [] : describeQuery(entity, ctx.query)),
    count: async ctx => {
      if (ctx.ids) return ctx.ids.length
      const q = entityQuery(entity, ctx, filters)
      if (!q) return 0
      const r = await cappedCount(entity, q, ctx.cap)
      return r.count
    },
    sections: async ctx => {
      const q = entityQuery(entity, ctx, filters)
      const rows: AsyncIterable<ExportRow[]> = q ? entityBatches(entity, q, ctx.ids, ctx.cap) : (async function* () {})()
      return [{ key: entity.key, rows, totals: 'auto' }]
    },
  }
}

/** "Status: Shipped, Delivered" lines for the page's own filters (period left to the header). */
export function describeQuery(entity: FilterEntity, query: URLSearchParams): string[] {
  const q = normalizeQuery(entity, query)
  const p = periodParams(entity)
  const out: string[] = []
  const search = entity.search ? q[searchParamOf(entity)] : undefined
  if (search) out.push(`Search: “${search}”`)
  for (const f of entity.fields) {
    const names = paramNamesOf(f)
    if (p && names.includes(p[0])) continue
    const vals = names.map(n => q[n]).filter(Boolean)
    if (!vals.length) continue
    if (names.length === 2) {
      out.push(`${f.label}: ${q[names[0]] ?? '…'} – ${q[names[1]] ?? '…'}`)
      continue
    }
    const labels = splitFilterValues(vals[0]).map(v => f.options?.find(o => o.value === v)?.label ?? v)
    out.push(`${f.label}: ${labels.join(', ')}`)
  }
  return out
}
