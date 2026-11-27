import 'server-only'
import { defineExport, type ExportDefinition, type ExportRunContext } from '../define'
import type { ExportColumn } from '../types'

// Every page's Insights drawer (daily series over 13–52 weeks) exports through this one definition.
// The drawer sends the days it is showing, so the export is exactly what is on screen; nothing is
// read from the DB, which is why any signed-in admin may run it. The page describes its series in the
// query: title, series=key:Label|…, from, to, today (later days are dropped), filter (label), top=1.

const DAY = /^\d{4}-\d{2}-\d{2}$/

function seriesDefs(q: URLSearchParams): { key: string; label: string }[] {
  return (q.get('series') ?? '')
    .split('|')
    .map(p => {
      const i = p.indexOf(':')
      const key = (i < 0 ? p : p.slice(0, i)).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40)
      return { key, label: (i < 0 ? key : p.slice(i + 1)).slice(0, 60) || key }
    })
    .filter(s => s.key)
    .slice(0, 12)
}

function columnsFor(q: URLSearchParams): ExportColumn[] {
  const defs = seriesDefs(q)
  const cols: ExportColumn[] = [{ key: 'date', label: 'Date', type: 'date', id: true }]
  for (const s of defs.length ? defs : [{ key: 'count', label: q.get('unit') || 'Count' }]) cols.push({ key: `s:${s.key}`, label: s.label, type: 'number', total: 'sum' })
  if (defs.length > 1) cols.push({ key: 'total', label: 'Total', type: 'number', total: 'sum' })
  if (q.get('top') === '1') cols.push({ key: 'top', label: 'Top items', width: 2.5, optional: true })
  return cols
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function toRows(ctx: ExportRunContext) {
  const defs = seriesDefs(ctx.query)
  const keys = defs.length ? defs.map(d => d.key) : ['count']
  return (ctx.rows ?? [])
    .filter(d => typeof d.date === 'string' && DAY.test(d.date) && (!ctx.query.get('today') || d.date <= ctx.query.get('today')!))
    .map(d => {
      const values = Array.isArray(d.values) ? d.values : []
      const row: Record<string, unknown> = { date: d.date }
      keys.forEach((k, i) => (row[`s:${k}`] = num(values[i])))
      row.total = values.reduce((a: number, v) => a + num(v), 0)
      const top = Array.isArray(d.top) ? (d.top as { name?: unknown; count?: unknown }[]) : []
      row.top = top.map(t => `${String(t.name ?? '')}: ${num(t.count)}`).join(', ')
      return row
    })
}

export const INSIGHTS_EXPORT = defineExport({
  key: 'insights.series',
  title: 'Insights',
  noun: 'Days',
  scope: '',
  clientRows: true,
  columns: columnsFor(new URLSearchParams()),
  columnsFor,
  titleFor: q => `${(q.get('title') || 'Insights').slice(0, 80)} — daily`,
  scopes: ['filtered'],
  period: ctx => {
    const from = ctx.query.get('from')
    const to = ctx.query.get('to')
    return from && to && DAY.test(from) && DAY.test(to) ? `${from} – ${to}` : null
  },
  describe: ctx => (ctx.query.get('filter') ? [`View: ${ctx.query.get('filter')!.slice(0, 80)}`] : []),
  filename: ctx => `${(ctx.query.get('title') || 'insights').toLowerCase()}-${ctx.query.get('from') ?? ''}_${ctx.query.get('to') ?? ''}`,
  count: async ctx => toRows(ctx).length,
  sections: async ctx => {
    const rows = toRows(ctx)
    const busiest = rows.reduce<{ date: string; n: number } | null>((b, r) => (!b || (r.total as number) > b.n ? { date: r.date as string, n: r.total as number } : b), null)
    return [
      {
        key: 'days',
        rows,
        summary: [
          { label: 'Days', value: rows.length, type: 'int' },
          { label: 'Total', value: rows.reduce((a, r) => a + (r.total as number), 0), type: 'number' },
          ...(busiest && busiest.n > 0 ? [{ label: 'Busiest day', value: `${busiest.date} (${busiest.n})` }] : []),
        ],
      },
    ]
  },
})

export const INSIGHTS_EXPORTS: ExportDefinition[] = [INSIGHTS_EXPORT]
