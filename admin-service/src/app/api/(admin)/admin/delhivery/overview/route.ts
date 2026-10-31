import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { eddSettingsFromValues } from '@/lib/shipping/edd'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import {
  BOUNDS,
  boundArgs,
  bucketSeriesSql,
  bucketSql,
  byPeriod,
  inBoth,
  inCur,
  n,
  nn,
  per,
  seriesFromRows,
  type Row,
} from '@/lib/overviews/orders'
import { COD_STALE_DAYS, IN_TRANSIT_STATUSES, delhiveryAttention, zoneStats } from '@/lib/overviews/delhivery'

export const dynamic = 'force-dynamic'

const AWB = `o.awb_number IS NOT NULL AND o.status NOT IN ('draft', 'cancelled')`

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'delhivery:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = boundArgs(period)

  try {
    const bv = await getBusinessValues().catch(() => null)
    const settings = eddSettingsFromValues(bv)
    const originPin = bv?.delhiveryOriginPincode || undefined

    const [shipped, delivered, cod, pickups, snapshot, pickupSnap, deliveredRows, series, recentPickups] =
      await Promise.all([
        queryMany<Row>(
          `WITH ${BOUNDS}
         SELECT ${per('o.shipped_at')} AS period,
                COUNT(*) AS shipments,
                COUNT(*) FILTER (WHERE o.shipment_status LIKE 'rto%') AS rto,
                COUNT(*) FILTER (WHERE o.delhivery_billed_amount IS NOT NULL) AS billed,
                COALESCE(SUM(o.delhivery_billed_amount), 0) AS freight,
                COALESCE(SUM(o.delhivery_extra_charge) FILTER (WHERE o.delhivery_extra_charge > 0), 0) AS extra,
                COUNT(*) FILTER (WHERE o.delhivery_charged_weight_kg > o.delhivery_quoted_weight_kg) AS weight_disputes,
                COALESCE(SUM(o.total_amount), 0) AS shipped_value
         FROM orders o, b
         WHERE ${inBoth('o.shipped_at')} AND ${AWB}
         GROUP BY 1`,
          args
        ),
        queryMany<Row>(
          `WITH ${BOUNDS}
         SELECT ${per('o.delivered_at')} AS period,
                COUNT(*) AS delivered,
                AVG(EXTRACT(EPOCH FROM o.delivered_at - o.shipped_at) / 86400)
                  FILTER (WHERE o.delivered_at >= o.shipped_at) AS transit_days,
                COUNT(*) FILTER (WHERE o.estimated_delivery_date IS NOT NULL) AS with_promise,
                COUNT(*) FILTER (WHERE (o.delivered_at AT TIME ZONE 'Asia/Kolkata')::date <= o.estimated_delivery_date) AS on_time
         FROM orders o, b
         WHERE ${inBoth('o.delivered_at')} AND ${AWB} AND o.status = 'delivered'
         GROUP BY 1`,
          args
        ),
        queryMany<Row>(
          `WITH ${BOUNDS},
         ev AS (
           SELECT ${per('o.delivered_at')} AS period, o.total_amount AS collected, 0::numeric AS remitted
           FROM orders o, b
           WHERE o.payment_mode = 'cod' AND ${inBoth('o.delivered_at')} AND o.payment_status IN ('cod_collected', 'paid')
           UNION ALL
           SELECT ${per('o.cod_remitted_at')}, 0, o.total_amount
           FROM orders o, b
           WHERE o.payment_mode = 'cod' AND ${inBoth('o.cod_remitted_at')})
         SELECT period, COALESCE(SUM(collected), 0) AS collected, COUNT(*) FILTER (WHERE collected > 0) AS collected_n,
                COALESCE(SUM(remitted), 0) AS remitted, COUNT(*) FILTER (WHERE remitted > 0) AS remitted_n
         FROM ev GROUP BY 1`,
          args
        ),
        queryMany<Row>(
          `WITH ${BOUNDS}
         SELECT ${per('p.created_at')} AS period, COUNT(*) AS requests, COALESCE(SUM(p.awb_count), 0) AS awbs,
                COUNT(*) FILTER (WHERE p.pickup_status = 'picked_up') AS picked_up,
                COUNT(*) FILTER (WHERE p.pickup_status = 'failed') AS failed
         FROM delhivery_pickup_requests p, b
         WHERE ${inBoth('p.created_at')}
         GROUP BY 1`,
          args
        ),
        queryOne<Row>(
          `SELECT COUNT(*) FILTER (WHERE o.shipment_status = ANY($1::text[])) AS in_transit,
                COUNT(*) FILTER (WHERE o.shipment_status = 'delivery_attempted') AS ndr,
                COUNT(*) FILTER (WHERE o.shipment_status = ANY($1::text[])
                                   AND o.estimated_delivery_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue,
                COUNT(*) FILTER (WHERE o.shipment_status LIKE 'rto%' AND o.shipment_status <> 'rto_delivered') AS rto_open,
                COUNT(*) FILTER (WHERE COALESCE(o.shipment_status, 'created') = 'created' AND NOT EXISTS (
                  SELECT 1 FROM delhivery_pickup_requests p WHERE o.awb_number = ANY(p.awbs))) AS awaiting_pickup,
                COUNT(*) FILTER (WHERE COALESCE(o.shipment_status, 'created') = 'created' AND NOT EXISTS (
                  SELECT 1 FROM delhivery_pickup_requests p WHERE o.awb_number = ANY(p.awbs))
                  AND COALESCE(o.shipped_at, o.updated_at) < NOW() - interval '1 day') AS awaiting_pickup_stale,
                COUNT(*) FILTER (WHERE o.payment_mode = 'cod' AND o.payment_status = 'cod_collected' AND o.cod_remitted_at IS NULL) AS cod_unremitted,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_mode = 'cod' AND o.payment_status = 'cod_collected' AND o.cod_remitted_at IS NULL), 0) AS cod_unremitted_value,
                COUNT(*) FILTER (WHERE o.payment_mode = 'cod' AND o.payment_status = 'cod_collected' AND o.cod_remitted_at IS NULL
                                   AND o.delivered_at < NOW() - make_interval(days => $2::int)) AS cod_stale
         FROM orders o WHERE ${AWB}`,
          [[...IN_TRANSIT_STATUSES], COD_STALE_DAYS]
        ),
        queryOne<Row>(
          `SELECT COUNT(*) FILTER (WHERE pickup_status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE pickup_status = 'pending' AND pickup_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS missed,
                COUNT(*) FILTER (WHERE pickup_status = 'failed' AND created_at > NOW() - interval '14 days') AS failed_recent
         FROM delhivery_pickup_requests`
        ),
        queryMany<Row>(
          `WITH ${BOUNDS}
         SELECT COALESCE(NULLIF(TRIM(o.shipping_address_snapshot->>'postal_code'), ''), a.postal_code) AS pin,
                EXTRACT(EPOCH FROM o.delivered_at - o.shipped_at) / 86400 AS transit_days
         FROM orders o CROSS JOIN b
         LEFT JOIN addresses a ON a.id = o.shipping_address_id
         WHERE ${inCur('o.delivered_at')} AND ${AWB} AND o.status = 'delivered' AND o.shipped_at IS NOT NULL
           AND o.delivered_at >= o.shipped_at`,
          args
        ),
        queryMany<Row>(
          `WITH ${BOUNDS},
         s AS (SELECT d::date AS bucket FROM ${bucketSeriesSql(bucket)} d),
         sh AS (SELECT ${bucketSql('o.shipped_at', bucket)} AS bucket, COUNT(*) AS shipped
                FROM orders o, b WHERE ${inCur('o.shipped_at')} AND ${AWB} GROUP BY 1),
         dl AS (SELECT ${bucketSql('o.delivered_at', bucket)} AS bucket, COUNT(*) AS delivered
                FROM orders o, b WHERE ${inCur('o.delivered_at')} AND ${AWB} AND o.status = 'delivered' GROUP BY 1)
         SELECT s.bucket::text AS bucket, COALESCE(sh.shipped, 0) AS shipped, COALESCE(dl.delivered, 0) AS delivered
         FROM s LEFT JOIN sh ON sh.bucket = s.bucket LEFT JOIN dl ON dl.bucket = s.bucket
         ORDER BY s.bucket`,
          args
        ),
        queryMany<Row>(
          `SELECT id, pickup_id, pickup_date::text AS pickup_date, awb_count, pickup_status, created_at
         FROM delhivery_pickup_requests
         WHERE pickup_status <> 'picked_up'
         ORDER BY pickup_date DESC, created_at DESC LIMIT 8`
        ),
      ])

    const shipKpi = byPeriod(shipped, r => r)
    const delKpi = byPeriod(delivered, r => r)
    const codKpi = byPeriod(cod, r => r)
    const pickKpi = byPeriod(pickups, r => r)
    const kpi = (s: Row | undefined, d: Row | undefined, c: Row | undefined, p: Row | undefined) => {
      const shipments = n(s?.shipments)
      const billed = n(s?.billed)
      const withPromise = n(d?.with_promise)
      return {
        shipments,
        shippedValue: n(s?.shipped_value),
        delivered: n(d?.delivered),
        transitDays: nn(d?.transit_days),
        onTimeRate: withPromise ? n(d?.on_time) / withPromise : null,
        rto: n(s?.rto),
        rtoRate: shipments ? n(s?.rto) / shipments : null,
        freight: n(s?.freight),
        billed,
        freightPerOrder: billed ? n(s?.freight) / billed : null,
        extraCharges: n(s?.extra),
        weightDisputes: n(s?.weight_disputes),
        codCollected: n(c?.collected),
        codCollectedOrders: n(c?.collected_n),
        codRemitted: n(c?.remitted),
        codRemittedOrders: n(c?.remitted_n),
        pickupRequests: n(p?.requests),
        pickupAwbs: n(p?.awbs),
        pickupsPickedUp: n(p?.picked_up),
        pickupsFailed: n(p?.failed),
      }
    }

    const snap = {
      inTransit: n(snapshot?.in_transit),
      ndr: n(snapshot?.ndr),
      overdue: n(snapshot?.overdue),
      rtoOpen: n(snapshot?.rto_open),
      awaitingPickupRequest: n(snapshot?.awaiting_pickup),
      awaitingPickupStale: n(snapshot?.awaiting_pickup_stale),
      pendingPickups: n(pickupSnap?.pending),
      missedPickups: n(pickupSnap?.missed),
      failedPickups: n(pickupSnap?.failed_recent),
      codUnremitted: n(snapshot?.cod_unremitted),
      codUnremittedValue: n(snapshot?.cod_unremitted_value),
      codStale: n(snapshot?.cod_stale),
    }
    const current = kpi(shipKpi.current, delKpi.current, codKpi.current, pickKpi.current)

    return NextResponse.json({
      period,
      previous,
      bucket,
      kpis: { current, previous: kpi(shipKpi.previous, delKpi.previous, codKpi.previous, pickKpi.previous) },
      snapshot: snap,
      series: seriesFromRows(series, ['shipped', 'delivered']),
      zones: zoneStats(
        deliveredRows.map(r => ({ pin: (r.pin as string) ?? null, transitDays: nn(r.transit_days) })),
        originPin,
        settings
      ),
      pickups: recentPickups.map(r => ({
        id: String(r.id),
        pickupId: (r.pickup_id as string) ?? null,
        pickupDate: String(r.pickup_date),
        awbCount: n(r.awb_count),
        status: String(r.pickup_status),
        createdAt: r.created_at,
      })),
      attention: delhiveryAttention({ ...snap, weightDisputes: current.weightDisputes }),
    })
  } catch (err) {
    console.error('[delhivery/overview]', err)
    return NextResponse.json({ error: 'Failed to load shipping overview' }, { status: 500 })
  }
}
