import 'server-only'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import type { ColumnType, DateRange, ExportColumn, ExportFilter, ExportFormat, ExportOptions, ExportScope, FilterValues } from './types'

// A page's export: its columns, page-specific filters, and where the rows come from. Lists backed by
// the filter registry get one from entityExport(); reports write `sections` by calling the same
// function their page's API calls, so the exported totals are the totals on screen.

export type ExportRow = Record<string, unknown>

/** Rows in batches (streamed lists) or all at once (reports already in memory); any object shape. */
export type RowSource = readonly object[] | AsyncIterable<readonly object[]>

export interface ExportSection {
  key: string
  /** Shown above the table (sheet name in Excel, a heading in CSV/PDF, a slide title in PPTX). */
  title?: string
  /** The section's own fixed columns; omitted = the columns the user picked. */
  columns?: ExportColumn[]
  rows: RowSource
  /** Totals row: computed from `rows` by each column's `total` ('auto', the default), given, or none. */
  totals?: 'auto' | ExportRow | null
  /** Key figures printed under the section (and on the PPTX summary slide). */
  summary?: { label: string; value: unknown; type?: ColumnType }[]
}

export interface ExportRunContext {
  admin: AdminJWTPayload
  options: ExportOptions
  format: ExportFormat
  scope: ExportScope
  /** The page's query string at the time of export (filters, search, tab, sort). */
  query: URLSearchParams
  /** Row ids for the page / selected scopes; null for filtered / all. */
  ids: string[] | null
  range: DateRange
  filters: FilterValues
  /** Hard row cap for the format. */
  cap: number
  /** Rows the page already holds and sent along (`clientRows` definitions only), else null. */
  rows: Record<string, unknown>[] | null
}

export interface ExportDefinition {
  key: string
  title: string
  /** Plural noun for counts ("Orders"). */
  noun: string
  /** Read scope of the page; exportScope overrides it for the export. '' = any signed-in admin (clientRows only). */
  scope: string
  exportScope?: string
  columns: ExportColumn[]
  /** Columns that depend on the page (its query), replacing `columns`. */
  columnsFor?: (query: URLSearchParams) => ExportColumn[]
  /** Title that depends on the page (its query). */
  titleFor?: (query: URLSearchParams) => string
  /** The rows come from the page (data it already shows), not the DB: they arrive in `ctx.rows`. */
  clientRows?: boolean
  /** Static, or loaded per request (options that depend on the store: warehouses, channels in use). */
  filters?: ExportFilter[] | (() => Promise<ExportFilter[]>)
  /** Default ['filtered', 'all']; add 'page' / 'selected' when rows can be fetched by id. */
  scopes?: ExportScope[]
  formats?: ExportFormat[]
  /** The export takes a from/to range (pages with a period picker). */
  dateRange?: boolean | { label?: string }
  /** The page's period from its query, to preselect the range (entity lists derive it themselves). */
  rangeFromQuery?: (query: URLSearchParams) => DateRange | undefined
  /** File name base; defaults to the key. */
  filename?: (ctx: ExportRunContext) => string
  /** Period line for the header; defaults to the range. */
  period?: (ctx: ExportRunContext) => string | null
  /** Extra "filters applied" lines (the page's own filters); the export's include/exclude choices are added. */
  describe?: (ctx: ExportRunContext) => string[] | Promise<string[]>
  /** Rows the export would hold, for the dialog (null = unknown). */
  count?: (ctx: ExportRunContext) => Promise<number | null>
  sections: (ctx: ExportRunContext) => Promise<ExportSection[]>
}

export function defineExport(def: ExportDefinition): ExportDefinition {
  return def
}

/** A report held in memory, as batches: renderers treat every section the same way. */
export async function* batches(rows: ExportRow[], size = 1000): AsyncIterable<ExportRow[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size)
}

/** "1 Nov 2026 – 27 Nov 2026" for the header. */
export function formatRange(range: DateRange): string | null {
  const f = (d?: string) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null)
  const a = f(range.from)
  const b = f(range.to)
  if (a && b) return `${a} – ${b}`
  if (a) return `From ${a}`
  if (b) return `Until ${b}`
  return null
}
