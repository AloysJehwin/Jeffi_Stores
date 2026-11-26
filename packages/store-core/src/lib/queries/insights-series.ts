import { queryOne, queryMany } from './shared'
import { INSIGHTS_WEEKS_MAX, mondayGrid, summarize, type InsightsDay, type InsightsSeries } from '@/lib/insights/series'

const TZ = `'Asia/Kolkata'` // the store's local timezone, as every overview uses
const IDENT = /^[a-z_][a-z0-9_]*$/

export interface InsightsSeriesPart {
  key: string
  label: string
  /** Aggregate SQL, default COUNT(*). e.g. `SUM(t.total_amount)`. */
  value?: string
  /** Rows this series counts (a FILTER clause), e.g. `t.status = 'approved'`. */
  where?: string
}

export interface InsightsSeriesSpec {
  table: string
  /** Alias for `table` in every fragment; default `t`. */
  alias?: string
  dateColumn: string
  /** `timestamptz` (default) is bucketed into Asia/Kolkata days; `date` columns are used as they are. */
  dateKind?: 'timestamptz' | 'date'
  joins?: string
  /** Extra WHERE SQL. Write `$1`, `$2`… for `params`; the helper appends its own date bounds after them. */
  where?: string
  params?: unknown[]
  /** Stacked series, first one leads; default one `COUNT(*)` series. */
  series?: InsightsSeriesPart[]
  /** Per-day tooltip breakdown: the top `limit` (default 3) values of `label`, ranked by `value` (default COUNT(*)). */
  top?: { label: string; value?: string; limit?: number }
  weeks?: number
  /** Echoed back on the series so the drawer knows which filter it shows. */
  filter?: string | null
}

const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0)
const round = (v: number) => Math.round(v * 100) / 100

/**
 * Daily buckets over `weeks` Monday-aligned weeks (ending this week) for one table's date column, the series
 * behind a page's insights pop-over. Runs on the request's tenant pool (lib/shared/db). Table, alias and column
 * names are checked identifiers; `where`, `joins`, `series` and `top` are SQL from code, never user input, which
 * goes in `params`.
 */
export async function getInsightsSeries(spec: InsightsSeriesSpec): Promise<InsightsSeries> {
  const alias = spec.alias ?? 't'
  const col = spec.dateColumn
  for (const id of [spec.table, alias, col]) if (!IDENT.test(id)) throw new Error(`insights: bad identifier "${id}"`)
  const weeks = Math.min(INSIGHTS_WEEKS_MAX, Math.max(1, Math.floor(spec.weeks ?? 26) || 26))
  const parts = spec.series?.length ? spec.series : [{ key: 'count', label: 'Count' }]
  const params = spec.params ?? []

  const todayRow = await queryOne<{ today: string }>(`SELECT to_char((NOW() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS today`)
  const today = todayRow?.today ?? new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  const grid = mondayGrid(today, weeks)

  const a = `$${params.length + 1}`
  const b = `$${params.length + 2}`
  const c = `${alias}.${col}`
  const local = spec.dateKind === 'date' ? `${c}` : `(${c} AT TIME ZONE ${TZ})::date`
  const range =
    spec.dateKind === 'date'
      ? `${c} >= ${a}::date AND ${c} <= ${b}::date`
      : `${c} >= (${a}::date)::timestamp AT TIME ZONE ${TZ} AND ${c} < (${b}::date + 1)::timestamp AT TIME ZONE ${TZ}`
  const from = `FROM ${spec.table} ${alias}${spec.joins ? ` ${spec.joins}` : ''}
   WHERE ${range}${spec.where ? ` AND (${spec.where})` : ''}`
  const args = [...params, grid.from, grid.to]

  const cols = parts
    .map((p, i) => {
      const agg = p.value ?? 'COUNT(*)'
      return `COALESCE(${p.where ? `${agg} FILTER (WHERE ${p.where})` : agg}, 0) AS s${i}`
    })
    .join(', ')

  const [dayRows, topRows] = await Promise.all([
    queryMany<Record<string, string>>(`SELECT to_char(${local}, 'YYYY-MM-DD') AS day, ${cols} ${from} GROUP BY 1`, args),
    spec.top
      ? queryMany<Record<string, string>>(
          `SELECT day, name, n FROM (
             SELECT day, name, n, ROW_NUMBER() OVER (PARTITION BY day ORDER BY n DESC, name) AS rn FROM (
               SELECT to_char(${local}, 'YYYY-MM-DD') AS day, COALESCE((${spec.top.label})::text, 'Other') AS name, ${spec.top.value ?? 'COUNT(*)'} AS n
               ${from}
               GROUP BY 1, 2
             ) g
           ) r WHERE rn <= ${Math.min(10, Math.max(1, Math.floor(spec.top.limit ?? 3)))}`,
          args
        )
      : Promise.resolve([] as Record<string, string>[]),
  ])

  const byDay = new Map<string, Record<string, string>>()
  for (const r of dayRows ?? []) byDay.set(String(r.day), r)
  const topByDay = new Map<string, { name: string; count: number }[]>()
  for (const r of topRows ?? []) {
    const list = topByDay.get(String(r.day)) ?? []
    list.push({ name: String(r.name), count: round(num(r.n)) })
    topByDay.set(String(r.day), list)
  }

  const days: InsightsDay[] = grid.dates.map(date => {
    const r = byDay.get(date)
    const day: InsightsDay = { date, values: parts.map((_, i) => round(num(r?.[`s${i}`]))) }
    if (spec.top) day.top = (topByDay.get(date) ?? []).sort((x, y) => y.count - x.count)
    return day
  })

  return {
    weeks,
    filter: spec.filter ?? null,
    from: grid.from,
    to: grid.to,
    today,
    series: parts.map(p => ({ key: p.key, label: p.label })),
    days,
    totals: summarize(days, today),
  }
}
