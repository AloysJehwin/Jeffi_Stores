import type { FilterScope, ScopeSql } from '@jeffi/list-filters'
import type { AttentionItem } from '@/lib/overview/attention'
import { queryMany, queryOne } from '@/lib/shared/db'
import { previousPeriod, type Period } from '@/lib/overview/period'
import {
  BOUNDS,
  NEEDS_SHIP_SQL,
  boundArgs,
  byPeriod,
  inBoth,
  n,
  nn,
  per,
  type Row,
  type StripKpi,
} from '@/lib/overviews/orders'

export interface PackingSnapshot {
  toPack: number
  late: number
  oldest: string | null
  shippedToday: number
}

export function packingAttention(s: PackingSnapshot, handlingDays: number): AttentionItem[] {
  const out: AttentionItem[] = []
  if (s.late)
    out.push({
      key: 'late',
      severity: 'critical',
      title: `${s.late} ${s.late === 1 ? 'order is' : 'orders are'} past the ${handlingDays}-day dispatch window`,
      href: '/admin/orders?tab=list&status=processing',
    })
  if (s.toPack)
    out.push({
      key: 'to_pack',
      severity: 'info',
      title: `${s.toPack} ${s.toPack === 1 ? 'order' : 'orders'} to pack and ship`,
      href: '/admin/orders?tab=list&status=confirmed',
    })
  return out
}

const NONE: ScopeSql = { sql: '', params: [] }

/** `scope`: the slips list's filters (on o), appended after each query's own args. */
export async function loadPackingStrip(period: Period, handlingDays: number, scope?: FilterScope) {
  const s4 = scope?.and(4) ?? NONE
  const s2 = scope?.and(2) ?? NONE
  const s1 = scope?.and(1) ?? NONE
  const [shipped, snap, today] = await Promise.all([
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT ${per('o.shipped_at')} AS period, COUNT(*) AS shipped,
              AVG(EXTRACT(EPOCH FROM o.shipped_at - COALESCE(o.confirmed_at, o.created_at)) / 3600)
                FILTER (WHERE o.shipped_at >= COALESCE(o.confirmed_at, o.created_at)) AS dispatch_hours
       FROM orders o, b
       WHERE ${inBoth('o.shipped_at')} AND o.status NOT IN ('draft', 'cancelled') AND ${NEEDS_SHIP_SQL}${s4.sql}
       GROUP BY 1`,
      [...boundArgs(period), ...s4.params]
    ),
    queryOne<Row>(
      `SELECT COUNT(*) AS to_pack,
              COUNT(*) FILTER (WHERE COALESCE(o.confirmed_at, o.created_at) < NOW() - make_interval(days => $1::int)) AS late,
              MIN(COALESCE(o.confirmed_at, o.created_at)) AS oldest
       FROM orders o
       WHERE o.status IN ('confirmed', 'processing') AND o.shipped_at IS NULL AND ${NEEDS_SHIP_SQL}${s2.sql}`,
      [handlingDays, ...s2.params]
    ),
    (s1.params.length ? (sql: string) => queryOne<Row>(sql, s1.params) : (sql: string) => queryOne<Row>(sql))(
      `SELECT COUNT(*) AS shipped_today FROM orders o
       WHERE o.shipped_at >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata'
         AND o.status NOT IN ('draft', 'cancelled') AND ${NEEDS_SHIP_SQL}${s1.sql}`
    ),
  ])
  const s = byPeriod(shipped, r => r)
  const snapshot: PackingSnapshot = {
    toPack: n(snap?.to_pack),
    late: n(snap?.late),
    oldest: (snap?.oldest as string | null) ?? null,
    shippedToday: n(today?.shipped_today),
  }
  const kpis: StripKpi[] = [
    { key: 'to_pack', label: 'To pack now', value: snapshot.toPack, previous: null, format: 'count' },
    {
      key: 'late',
      label: 'Late to dispatch',
      value: snapshot.late,
      previous: null,
      format: 'count',
      invert: true,
      sub: `Over ${handlingDays} days`,
    },
    { key: 'shipped_today', label: 'Shipped today', value: snapshot.shippedToday, previous: null, format: 'count' },
    {
      key: 'shipped',
      label: 'Shipped in period',
      value: n(s.current?.shipped),
      previous: n(s.previous?.shipped),
      format: 'count',
    },
    {
      key: 'dispatch',
      label: 'Avg time to dispatch',
      value: nn(s.current?.dispatch_hours),
      previous: nn(s.previous?.dispatch_hours),
      format: 'hours',
      invert: true,
    },
  ]
  return {
    period,
    previous: previousPeriod(period),
    kpis,
    snapshot,
    filtered: !!scope && !scope.empty,
    attention: packingAttention(snapshot, handlingDays),
  }
}
