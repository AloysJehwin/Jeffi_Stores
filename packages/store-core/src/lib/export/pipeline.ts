import 'server-only'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { resolveTenant, runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { adminDisplayName, loadBrand } from './branding'
import { formatRange, type ExportDefinition, type ExportRow, type ExportRunContext, type RowSource } from './define'
import { listPresets, savePreset } from './presets'
import type { ExportDocument, ResolvedSection } from './render/common'
import {
  EXPORT_FORMATS,
  FORMAT_LABELS,
  FORMAT_ROW_CAPS,
  MAX_CLIENT_ROWS,
  MAX_IDS,
  SCOPE_LABELS,
  defaultOptions,
  describeFilterValues,
  exportFilename,
  sanitizeOptions,
  type ExportContext,
  type ExportFilter,
  type ExportRequestBody,
  type ExportSchema,
  type ExportScope,
} from './types'

// One pipeline for every export: validate the request against the definition, build the run
// context, ask the definition for its sections, cap and tenant-bind the row streams, load the
// letterhead, render the format and stream it back; audit and remember the choices on the way.

export class ExportError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

type Run = <T>(fn: () => Promise<T>) => Promise<T>

async function filtersOf(def: ExportDefinition): Promise<ExportFilter[]> {
  if (!def.filters) return []
  return typeof def.filters === 'function' ? def.filters() : def.filters
}

function base(def: ExportDefinition, filters: ExportFilter[], query: URLSearchParams) {
  return {
    columns: def.columnsFor?.(query) ?? def.columns,
    filters,
    scopes: def.scopes ?? (['filtered', 'all'] as ExportScope[]),
    formats: def.formats ?? [...EXPORT_FORMATS],
    dateRange: def.dateRange ? { label: typeof def.dateRange === 'object' && def.dateRange.label ? def.dateRange.label : 'Date range' } : null,
  }
}

export async function exportSchema(def: ExportDefinition, admin: AdminJWTPayload, query: URLSearchParams): Promise<ExportSchema> {
  const filters = await filtersOf(def)
  const b = base(def, filters, query)
  const range = def.rangeFromQuery?.(query)
  const saved = await listPresets(admin.adminId, def.key).catch(() => ({ presets: [], last: null }))
  return {
    key: def.key,
    title: def.titleFor?.(query) ?? def.title,
    noun: def.noun,
    ...b,
    caps: FORMAT_ROW_CAPS,
    range,
    defaults: defaultOptions({ ...b, range }),
    presets: saved.presets.map(p => ({ ...p, options: sanitizeOptions(b, p.options) })),
    last: saved.last ? sanitizeOptions(b, saved.last) : null,
  }
}

const cleanIds = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100))].slice(0, MAX_IDS) : []

/** Client-held rows: plain objects of primitives (or arrays of them), capped; anything else is dropped. */
function cleanRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  const ok = (v: unknown): boolean =>
    v == null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 2000) || (Array.isArray(v) && v.length <= 100 && v.every(x => ok(x) || (typeof x === 'object' && x !== null && Object.values(x).every(y => typeof y !== 'object' && ok(y)))))
  return rows
    .slice(0, MAX_CLIENT_ROWS)
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r) && Object.keys(r).length <= 100 && Object.values(r).every(ok))
}

export async function runContext(
  def: ExportDefinition,
  admin: AdminJWTPayload,
  body: ExportRequestBody
): Promise<{ ctx: ExportRunContext; filters: ExportFilter[]; columns: ExportDefinition['columns'] }> {
  const filters = await filtersOf(def)
  const context: ExportContext = body.context ?? {}
  const query = new URLSearchParams(typeof context.query === 'string' ? context.query.slice(0, 8000) : '')
  const b = base(def, filters, query)
  const options = sanitizeOptions(b, body.options)
  let ids: string[] | null = null
  if (options.scope === 'page' || options.scope === 'selected') {
    ids = cleanIds(options.scope === 'page' ? context.pageIds : context.selectedIds)
    if (!ids.length) throw new ExportError(options.scope === 'page' ? 'No rows on this page to export.' : 'Select some rows first.')
  }
  return {
    filters,
    columns: b.columns,
    ctx: {
      admin,
      options,
      format: options.format,
      scope: options.scope,
      query,
      ids,
      range: options.range ?? {},
      filters: options.filters,
      cap: FORMAT_ROW_CAPS[options.format],
      rows: def.clientRows ? cleanRows(context.rows) : null,
    },
  }
}

export async function countExport(def: ExportDefinition, admin: AdminJWTPayload, body: ExportRequestBody): Promise<number | null> {
  const { ctx } = await runContext(def, admin, body)
  return def.count ? def.count(ctx) : null
}

/** Runs `next()` inside the request's tenant (the stream is pulled after the handler returns) and stops at the cap. */
function bindRows(src: RowSource, run: Run, cap: number, onCut: () => void, onRows: (n: number) => void): AsyncIterable<ExportRow[]> {
  const arr = Array.isArray(src) ? (src as ExportRow[]) : null
  return {
    [Symbol.asyncIterator]() {
      let taken = 0
      let i = 0
      const it = arr ? null : (src as AsyncIterable<ExportRow[]>)[Symbol.asyncIterator]()
      let done = false
      return {
        async next(): Promise<IteratorResult<ExportRow[]>> {
          if (done) return { done: true, value: undefined }
          let batch: ExportRow[] | undefined
          if (arr) {
            if (i >= arr.length) batch = undefined
            else {
              batch = arr.slice(i, i + 1000)
              i += batch.length
            }
          } else {
            const r = await run(() => it!.next())
            batch = r.done ? undefined : r.value
          }
          if (!batch) {
            done = true
            return { done: true, value: undefined }
          }
          if (taken + batch.length > cap) {
            batch = batch.slice(0, cap - taken)
            onCut()
            done = true
            if (it?.return) await run(() => it.return!(undefined)).catch(() => {})
          }
          taken += batch.length
          onRows(batch.length)
          return { done: false, value: batch }
        },
        async return(): Promise<IteratorResult<ExportRow[]>> {
          done = true
          if (it?.return) await run(() => it.return!(undefined)).catch(() => {})
          return { done: true, value: undefined }
        },
      }
    },
  }
}

export interface ExportResult {
  body: ReadableStream<Uint8Array>
  contentType: string
  filename: string
}

export async function runExport(def: ExportDefinition, admin: AdminJWTPayload, body: ExportRequestBody, request?: Request): Promise<ExportResult> {
  const { ctx, filters, columns } = await runContext(def, admin, body)
  const tenant = await resolveTenant()
  const run: Run = fn => (tenant ? runWithTenantContext(tenant, fn) : fn())
  const { options } = ctx
  const b = options.branding

  await savePreset(admin.adminId, def.key, '', options).catch(err => console.error('[export] last-used not saved', err))

  const needBrand = b.header && (b.storeName || b.gstin || b.address || b.logo)
  const [sections, brand, generatedBy, described] = await Promise.all([
    def.sections(ctx),
    needBrand || ctx.format === 'pdf' || ctx.format === 'pptx' ? loadBrand({ logo: b.logo && (ctx.format === 'pdf' || ctx.format === 'pptx') }) : Promise.resolve(null),
    adminDisplayName(admin),
    Promise.resolve(def.describe ? def.describe(ctx) : []),
  ])

  const scopeNote = ctx.scope === 'filtered' ? [] : [`Scope: ${SCOPE_LABELS[ctx.scope]}${ctx.ids ? ` (${ctx.ids.length.toLocaleString('en-IN')})` : ''}`]
  const doc: ExportDocument = {
    title: def.titleFor?.(ctx.query) ?? def.title,
    format: ctx.format,
    branding: b,
    brand,
    period: def.period ? def.period(ctx) : formatRange(ctx.range),
    generatedAt: new Date(),
    generatedBy,
    filters: [...scopeNote, ...described, ...describeFilterValues(filters, options.filters)],
    sections: [],
    truncated: null,
  }

  let rows = 0
  const byKey = new Map(columns.map(c => [c.key, c]))
  const picked = options.columns.map(k => byKey.get(k)!).filter(Boolean)
  doc.sections = sections.map(
    (s): ResolvedSection => ({
      key: s.key,
      title: s.title,
      columns: s.columns ?? picked,
      rows: bindRows(s.rows, run, ctx.cap, () => (doc.truncated = { cap: ctx.cap }), n => (rows += n)),
      totals: s.totals === undefined ? 'auto' : s.totals,
      summary: s.summary,
    })
  )

  const render =
    ctx.format === 'csv'
      ? (await import('./render/csv')).renderCsv(doc)
      : ctx.format === 'xlsx'
        ? await (await import('./render/xlsx')).renderXlsx(doc, run)
        : ctx.format === 'pdf'
          ? await (await import('./render/pdf')).renderPdf(doc, run)
          : await (await import('./render/pptx')).renderPptx(doc, run)

  let ended = false
  const finish = (completed: boolean) => {
    if (ended) return
    ended = true
    void run(() =>
      logAdminAudit({
        adminId: admin.adminId,
        action: 'export',
        entityType: def.key,
        summary: `Exported ${rows.toLocaleString('en-IN')} ${def.noun.toLowerCase()} to ${FORMAT_LABELS[ctx.format]}${completed ? '' : ' (cancelled)'}`,
        metadata: { format: ctx.format, scope: ctx.scope, rows, columns: options.columns, filters: options.filters, range: options.range, query: ctx.query.toString(), truncated: !!doc.truncated, completed },
        request: request as never,
      })
    ).catch(() => {})
  }
  const tracked = render.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush() {
        finish(true)
      },
    })
  )
  const reader = tracked.getReader()
  const out = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { value, done } = await reader.read()
        if (done) c.close()
        else c.enqueue(value)
      } catch (err) {
        finish(false)
        c.error(err)
      }
    },
    async cancel(reason) {
      finish(false)
      await reader.cancel(reason).catch(() => {})
    },
  })

  const name = def.filename ? def.filename(ctx) : def.key
  return { body: out, contentType: render.contentType, filename: exportFilename(name, ctx.format, def.filename ? null : undefined) }
}
