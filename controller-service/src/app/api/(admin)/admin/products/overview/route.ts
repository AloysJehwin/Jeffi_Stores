import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import { margin, num, numOrNull, periodArgs, priceChange } from '@/lib/overviews/catalog'
import {
  HEALTH_SAMPLES_SQL,
  HEALTH_SQL,
  HEALTH_ISSUES,
  MOST_VIEWED_SQL,
  NEVER_SOLD_SQL,
  PERIOD_SQL,
  PRICE_CHANGES_SQL,
  PRICE_CHANGE_STATS_SQL,
  RECENT_SQL,
  SELLERS_OUT_SQL,
  SERIES_SQL,
  TOP_SELLERS_SQL,
  healthCounts,
  productAttention,
  type HealthIssue,
} from '@/lib/overviews/products'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>

function periodStats(r: Row | undefined) {
  const costedNet = num(r?.costed_net)
  const cost = num(r?.cost)
  return {
    sales: num(r?.sales),
    units: num(r?.units),
    orders: num(r?.orders),
    productsSold: num(r?.products_sold),
    views: num(r?.views),
    added: num(r?.added),
    priceChanges: num(r?.price_changes),
    productsRepriced: num(r?.products_repriced),
    margin: margin(costedNet, cost),
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = periodArgs(period, previous)

  try {
    const [health, samples, sellersOut, periods, series, top, viewed, never, recent, changes, changeStats] =
      await Promise.all([
        queryOne<Row>(HEALTH_SQL),
        queryMany<Row>(HEALTH_SAMPLES_SQL, args.slice(0, 2)),
        queryMany<Row>(SELLERS_OUT_SQL, args),
        queryMany<Row>(PERIOD_SQL, args),
        queryMany<Row>(SERIES_SQL, [...args, bucket]),
        queryMany<Row>(TOP_SELLERS_SQL, args),
        queryMany<Row>(MOST_VIEWED_SQL, args),
        queryMany<Row>(NEVER_SOLD_SQL, args.slice(0, 2)),
        queryMany<Row>(RECENT_SQL, args.slice(0, 2)),
        queryMany<Row>(PRICE_CHANGES_SQL, args),
        queryOne<Row>(PRICE_CHANGE_STATS_SQL, args),
      ])

    const h = healthCounts(health)
    const outList = sellersOut.map(r => ({ id: String(r.id), name: String(r.name ?? ''), unitsCur: num(r.units_cur) }))
    const neverTotal = num(never[0]?.total)

    return NextResponse.json({
      period,
      previous,
      bucket,
      health: {
        ...h,
        samples: Object.fromEntries(
          HEALTH_ISSUES.map(issue => [
            issue,
            samples
              .filter(s => s.issue === issue)
              .map(s => ({ id: String(s.id), name: String(s.name ?? ''), sales: num(s.sales), views: num(s.views) })),
          ])
        ) as Record<HealthIssue, { id: string; name: string; sales: number; views: number }[]>,
      },
      current: periodStats(periods.find(r => r.cur === true)),
      previousStats: periodStats(periods.find(r => r.cur === false)),
      series: series.map(r => ({
        bucket: String(r.bucket),
        sales: num(r.sales),
        units: num(r.units),
        views: num(r.views),
      })),
      topSellers: top.map(r => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        units: num(r.units),
        sales: num(r.sales),
        prevSales: num(r.prev_sales),
        views: num(r.views),
        margin: margin(num(r.costed_net), num(r.cost)),
      })),
      mostViewed: viewed.map(r => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        views: num(r.views),
        sessions: num(r.sessions),
        orders: num(r.orders),
        units: num(r.units),
      })),
      neverSold: {
        total: neverTotal,
        items: never.map(r => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          createdAt: r.created_at,
          views: num(r.views),
        })),
      },
      recentlyAdded: recent.map(r => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        isActive: !!r.is_active,
        createdAt: r.created_at,
        issues: HEALTH_ISSUES.filter(i => !!r[i]),
      })),
      priceChanges: {
        bulk: num(changeStats?.bulk),
        manual: num(changeStats?.manual),
        increases: num(changeStats?.increases),
        decreases: num(changeStats?.decreases),
        cleared: num(changeStats?.cleared),
        avgChange: numOrNull(changeStats?.avg_change),
        recent: changes.map(r => ({
          id: String(r.id),
          at: r.created_at,
          productId: (r.product_id as string) ?? null,
          name: (r.name as string) ?? null,
          variant: (r.variant_name as string) ?? null,
          from: numOrNull(r.from_price),
          to: numOrNull(r.to_price),
          change: priceChange(r.from_price, r.to_price),
          bulk: !!r.bulk,
        })),
      },
      sellersOutOfStock: outList,
      attention: productAttention(h, outList, neverTotal),
    })
  } catch (err) {
    console.error('[products/overview]', err)
    return NextResponse.json({ error: 'Failed to load products overview' }, { status: 500 })
  }
}
