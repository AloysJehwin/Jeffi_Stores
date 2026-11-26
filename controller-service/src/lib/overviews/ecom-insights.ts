import { NextRequest, NextResponse } from 'next/server'
import type { Pool } from 'pg'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { controlPlanePool } from '@/lib/tenant-registry'
import { INSIGHTS_WEEKS_MAX, mondayGrid, parseInsightsQuery, summarize, type InsightsDay, type InsightsSeries } from '@/lib/insights/series'
import type { InsightsSeriesSpec } from '@/lib/queries/insights-series'

const TZ = `'Asia/Kolkata'`
const IDENT = /^[a-z_][a-z0-9_]*$/
const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0)
const round = (v: number) => Math.round(v * 100) / 100

/**
 * getInsightsSeries (the same spec, Asia/Kolkata days, Monday-aligned weeks) on an explicit pool: the platform pages read
 * the control plane, not the request's store pool the shared helper uses. SQL in `where`, `joins` and `series` is from
 * code, never user input; user values go in `params`.
 */
export async function poolInsightsSeries(pool: Pool, spec: InsightsSeriesSpec): Promise<InsightsSeries> {
  const alias = spec.alias ?? 't'
  for (const id of [spec.table, alias, spec.dateColumn]) if (!IDENT.test(id)) throw new Error(`insights: bad identifier "${id}"`)
  const weeks = Math.min(INSIGHTS_WEEKS_MAX, Math.max(1, Math.floor(spec.weeks ?? 26) || 26))
  const parts = spec.series?.length ? spec.series : [{ key: 'count', label: 'Count' }]
  const params = spec.params ?? []

  const todayRow = await pool.query(`SELECT to_char((NOW() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS today`)
  const today: string = todayRow.rows[0]?.today ?? new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  const grid = mondayGrid(today, weeks)

  const a = `$${params.length + 1}`
  const b = `$${params.length + 2}`
  const c = `${alias}.${spec.dateColumn}`
  const cols = parts.map((p, i) => `COALESCE(${p.where ? `${p.value ?? 'COUNT(*)'} FILTER (WHERE ${p.where})` : (p.value ?? 'COUNT(*)')}, 0) AS s${i}`).join(', ')
  const { rows } = await pool.query(
    `SELECT to_char((${c} AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, ${cols}
     FROM ${spec.table} ${alias}${spec.joins ? ` ${spec.joins}` : ''}
     WHERE ${c} >= (${a}::date)::timestamp AT TIME ZONE ${TZ} AND ${c} < (${b}::date + 1)::timestamp AT TIME ZONE ${TZ}${spec.where ? ` AND (${spec.where})` : ''}
     GROUP BY 1`,
    [...params, grid.from, grid.to]
  )

  const byDay = new Map<string, Record<string, string>>()
  for (const r of rows) byDay.set(String(r.day), r)
  const days: InsightsDay[] = grid.dates.map(date => ({ date, values: parts.map((_, i) => round(num(byDay.get(date)?.[`s${i}`]))) }))
  return { weeks, filter: spec.filter ?? null, from: grid.from, to: grid.to, today, series: parts.map(p => ({ key: p.key, label: p.label })), days, totals: summarize(days, today) }
}

/**
 * Shared GET handler for the platform pages' insights series: the page's read scope plus the platform-admin check
 * ecomOverviewGet applies, a checked ?weeks and ?filter, and the control-plane pool.
 */
export async function ecomInsightsGet(
  request: NextRequest,
  scope: string,
  filters: readonly string[] | undefined,
  run: (pool: Pool, q: { weeks: number; filter: string | null }) => Promise<InsightsSeries>
) {
  const admin = await requireAdminScope(request, scope)
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const q = parseInsightsQuery(request.nextUrl.searchParams, filters)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({ series: await run(controlPlanePool(), q) })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load insights' }, { status: 500 })
  }
}
