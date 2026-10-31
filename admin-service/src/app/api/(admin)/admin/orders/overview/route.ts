import { NextRequest, NextResponse } from 'next/server'
import { canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { eddSettingsFromValues } from '@/lib/shipping/edd'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import {
  BOUNDS,
  CANCEL_REASON_LABELS,
  CANCEL_REASON_SQL,
  NEEDS_SHIP_SQL,
  PIPELINE,
  SOURCE_LABELS,
  boundArgs,
  bucketSeriesSql,
  bucketSql,
  byPeriod,
  inBoth,
  inCur,
  n,
  nn,
  ordersAttention,
  per,
  seriesFromRows,
  type CancelReason,
  type Row,
} from '@/lib/overviews/orders'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'
import { ORDER_FIELDS } from '@/lib/filters/fields/orders'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'orders:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = boundArgs(period)

  try {
    const handlingDays = eddSettingsFromValues(await getBusinessValues().catch(() => null)).handlingDays
    // The list's filters (not its date: the period owns from/to), appended after each query's own args.
    const q = normalizeQuery(ORDERS_ENTITY, sp)
    const scope = filterScope(ORDERS_ENTITY, q, { omit: ['created'], ctx: { handlingDays } })
    const s4 = scope.and(args.length + 1)
    const s2 = scope.and(2)

    const [placed, shipped, delivered, snapshot, pipeline, series, bySource, byState, cancels] = await Promise.all([
      queryMany<Row>(
        `WITH ${BOUNDS}
         SELECT ${per('o.created_at')} AS period,
                COUNT(*) AS placed,
                COUNT(*) FILTER (WHERE o.status <> 'cancelled') AS live,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.status <> 'cancelled'), 0) AS value,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS paid_value,
                COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.payment_mode = 'cod') AS cod,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.status <> 'cancelled' AND o.payment_mode = 'cod'), 0) AS cod_value
         FROM orders o, b
         WHERE ${inBoth('o.created_at')} AND o.status <> 'draft'${s4.sql}
         GROUP BY 1`,
        [...args, ...s4.params]
      ),
      queryMany<Row>(
        `WITH ${BOUNDS}
         SELECT ${per('o.shipped_at')} AS period,
                COUNT(*) AS shipped,
                AVG(EXTRACT(EPOCH FROM o.shipped_at - COALESCE(o.confirmed_at, o.created_at)) / 3600)
                  FILTER (WHERE o.shipped_at >= COALESCE(o.confirmed_at, o.created_at)) AS dispatch_hours,
                COUNT(*) FILTER (WHERE o.shipment_status LIKE 'rto%') AS rto
         FROM orders o, b
         WHERE ${inBoth('o.shipped_at')} AND o.status <> 'draft'${s4.sql}
         GROUP BY 1`,
        [...args, ...s4.params]
      ),
      queryMany<Row>(
        `WITH ${BOUNDS}
         SELECT ${per('o.delivered_at')} AS period,
                COUNT(*) AS delivered,
                AVG(EXTRACT(EPOCH FROM o.delivered_at - o.shipped_at) / 86400)
                  FILTER (WHERE o.delivered_at >= o.shipped_at) AS transit_days,
                AVG(EXTRACT(EPOCH FROM o.delivered_at - o.created_at) / 86400) AS order_to_door_days,
                COUNT(*) FILTER (WHERE o.estimated_delivery_date IS NOT NULL) AS with_promise,
                COUNT(*) FILTER (WHERE (o.delivered_at AT TIME ZONE 'Asia/Kolkata')::date <= o.estimated_delivery_date) AS on_time
         FROM orders o, b
         WHERE ${inBoth('o.delivered_at')} AND o.status = 'delivered' AND o.shipped_at IS NOT NULL${s4.sql}
         GROUP BY 1`,
        [...args, ...s4.params]
      ),
      queryOne<Row>(
        `SELECT COUNT(*) FILTER (WHERE o.status = 'pending') AS to_confirm,
                COUNT(*) FILTER (WHERE o.status = 'pending' AND o.created_at < NOW() - interval '1 day') AS to_confirm_stale,
                MIN(o.created_at) FILTER (WHERE o.status = 'pending') AS oldest_pending,
                COUNT(*) FILTER (WHERE o.status IN ('confirmed', 'processing') AND o.shipped_at IS NULL AND ${NEEDS_SHIP_SQL}) AS to_ship,
                COUNT(*) FILTER (WHERE o.status IN ('confirmed', 'processing') AND o.shipped_at IS NULL AND ${NEEDS_SHIP_SQL}
                                   AND COALESCE(o.confirmed_at, o.created_at) < NOW() - make_interval(days => $1::int)) AS late_to_ship,
                COUNT(*) FILTER (WHERE o.status = 'cancel_requested') AS cancel_requests,
                COUNT(*) FILTER (WHERE o.status = 'return_requested') AS return_requests,
                COUNT(*) FILTER (WHERE o.status IN ('shipped', 'out_for_delivery')
                                   AND o.estimated_delivery_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue_delivery,
                COUNT(*) FILTER (WHERE o.payment_status = 'unpaid' AND o.payment_mode NOT IN ('cod', 'credit')
                                   AND o.status NOT IN ('cancelled', 'draft') AND o.created_at < NOW() - interval '1 day') AS unpaid_prepaid
         FROM orders o${s2.sql ? ` WHERE TRUE${s2.sql}` : ''}`,
        [handlingDays, ...s2.params]
      ),
      queryMany<Row>(
        `SELECT o.status, COUNT(*) AS count, COALESCE(SUM(o.total_amount), 0) AS value
         FROM orders o WHERE o.status = ANY($1::text[])${s2.sql} GROUP BY 1`,
        [PIPELINE.map(p => p.status), ...s2.params]
      ),
      queryMany<Row>(
        `WITH ${BOUNDS},
         s AS (SELECT d::date AS bucket FROM ${bucketSeriesSql(bucket)} d),
         placed AS (
           SELECT ${bucketSql('o.created_at', bucket)} AS bucket, COUNT(*) AS orders,
                  COALESCE(SUM(o.total_amount), 0) AS value
           FROM orders o, b WHERE ${inCur('o.created_at')} AND o.status NOT IN ('draft', 'cancelled')${s4.sql} GROUP BY 1),
         shipped AS (
           SELECT ${bucketSql('o.shipped_at', bucket)} AS bucket, COUNT(*) AS shipped
           FROM orders o, b WHERE ${inCur('o.shipped_at')} AND o.status <> 'draft'${s4.sql} GROUP BY 1)
         SELECT s.bucket::text AS bucket, COALESCE(p.orders, 0) AS orders, COALESCE(p.value, 0) AS value,
                COALESCE(sh.shipped, 0) AS shipped
         FROM s LEFT JOIN placed p ON p.bucket = s.bucket LEFT JOIN shipped sh ON sh.bucket = s.bucket
         ORDER BY s.bucket`,
        [...args, ...s4.params]
      ),
      queryMany<Row>(
        `WITH ${BOUNDS}
         SELECT o.source, COUNT(*) AS orders, COALESCE(SUM(o.total_amount), 0) AS value
         FROM orders o, b
         WHERE ${inCur('o.created_at')} AND o.status NOT IN ('draft', 'cancelled')${s4.sql}
         GROUP BY 1 ORDER BY value DESC`,
        [...args, ...s4.params]
      ),
      queryMany<Row>(
        `WITH ${BOUNDS}
         SELECT COALESCE(NULLIF(TRIM(o.shipping_address_snapshot->>'state'), ''), NULLIF(TRIM(a.state), ''), 'Unknown') AS state,
                COUNT(*) AS orders, COALESCE(SUM(o.total_amount), 0) AS value
         FROM orders o CROSS JOIN b
         LEFT JOIN addresses a ON a.id = o.shipping_address_id
         WHERE ${inCur('o.created_at')} AND o.status NOT IN ('draft', 'cancelled')${s4.sql}
         GROUP BY 1 ORDER BY value DESC LIMIT 10`,
        [...args, ...s4.params]
      ),
      queryMany<Row>(
        `WITH ${BOUNDS}
         SELECT ${CANCEL_REASON_SQL} AS reason, COUNT(*) AS count, COALESCE(SUM(o.total_amount), 0) AS value
         FROM orders o, b
         WHERE ${inCur('o.created_at')} AND o.status = 'cancelled'${s4.sql}
         GROUP BY 1 ORDER BY count DESC`,
        [...args, ...s4.params]
      ),
    ])

    const kpi = (p: Row | undefined, s: Row | undefined, d: Row | undefined) => {
      const live = n(p?.live)
      const value = n(p?.value)
      const shippedN = n(s?.shipped)
      const withPromise = n(d?.with_promise)
      return {
        placed: n(p?.placed),
        value,
        paidValue: n(p?.paid_value),
        aov: live ? value / live : null,
        cancelled: n(p?.cancelled),
        cancelRate: n(p?.placed) ? n(p?.cancelled) / n(p?.placed) : null,
        cod: n(p?.cod),
        prepaid: live - n(p?.cod),
        codValue: n(p?.cod_value),
        codShare: live ? n(p?.cod) / live : null,
        shipped: shippedN,
        dispatchHours: nn(s?.dispatch_hours),
        rto: n(s?.rto),
        rtoRate: shippedN ? n(s?.rto) / shippedN : null,
        delivered: n(d?.delivered),
        transitDays: nn(d?.transit_days),
        orderToDoorDays: nn(d?.order_to_door_days),
        onTimeRate: withPromise ? n(d?.on_time) / withPromise : null,
      }
    }
    const find = (rows: Row[], k: string) => rows.find(r => r.period === k)
    const pPlaced = byPeriod(placed, r => r)

    const snap = {
      toConfirm: n(snapshot?.to_confirm),
      toConfirmStale: n(snapshot?.to_confirm_stale),
      oldestPending: (snapshot?.oldest_pending as string | null) ?? null,
      toShip: n(snapshot?.to_ship),
      lateToShip: n(snapshot?.late_to_ship),
      cancelRequests: n(snapshot?.cancel_requests),
      returnRequests: n(snapshot?.return_requests),
      overdueDelivery: n(snapshot?.overdue_delivery),
      unpaidPrepaid: n(snapshot?.unpaid_prepaid),
    }

    return NextResponse.json({
      period,
      previous,
      bucket,
      handlingDays,
      kpis: {
        current: kpi(pPlaced.current, find(shipped, 'cur'), find(delivered, 'cur')),
        previous: kpi(pPlaced.previous, find(shipped, 'prev'), find(delivered, 'prev')),
      },
      snapshot: snap,
      pipeline: PIPELINE.map(p => {
        const r = pipeline.find(x => x.status === p.status)
        return { status: p.status, label: p.label, count: n(r?.count), value: n(r?.value) }
      }),
      series: seriesFromRows(series, ['orders', 'value', 'shipped']),
      bySource: bySource.map(r => ({
        source: String(r.source),
        label: SOURCE_LABELS[String(r.source)] ?? String(r.source),
        orders: n(r.orders),
        value: n(r.value),
      })),
      byState: byState.map(r => ({ state: String(r.state), orders: n(r.orders), value: n(r.value) })),
      cancellations: cancels.map(r => ({
        reason: String(r.reason),
        label: CANCEL_REASON_LABELS[r.reason as CancelReason] ?? String(r.reason),
        count: n(r.count),
        value: n(r.value),
      })),
      filtered: !scope.empty,
      attention: ordersAttention(snap, handlingDays, canonicalQuery(q, ORDER_FIELDS, { omit: ['from', 'to'] })),
    })
  } catch (err) {
    console.error('[orders/overview]', err)
    return NextResponse.json({ error: 'Failed to load orders overview' }, { status: 500 })
  }
}
