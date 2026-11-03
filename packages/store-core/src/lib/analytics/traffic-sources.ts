import { queryMany } from '@/lib/shared/db'

// Admin Traffic > Sources: orders, revenue and sessions by first-party click / UTM attribution.
// A click id (gclid / gbraid / wbraid) marks the row as Google Ads whatever its UTM tags say.

export const GOOGLE_ADS_CHANNEL = 'Google Ads'
export const UNATTRIBUTED_CHANNEL = 'Direct / unattributed'

const CHANNEL_SQL = `CASE
  WHEN COALESCE(gclid, gbraid, wbraid) IS NOT NULL THEN '${GOOGLE_ADS_CHANNEL}'
  WHEN NULLIF(utm_source, '') IS NOT NULL THEN LOWER(utm_source)
  ELSE '${UNATTRIBUTED_CHANNEL}'
END`

// Orders that represent real demand: online, not cancelled, not abandoned at payment.
const COUNTED_ORDER_SQL = `source = 'online' AND status <> 'cancelled' AND payment_status <> 'unpaid'`

export interface SourceOrdersRow {
  channel: string
  medium: string | null
  campaign: string | null
  orders: number
  revenue: number
}

export interface SourceSessionsRow {
  channel: string
  medium: string | null
  campaign: string | null
  sessions: number
}

export interface TrafficSources {
  orders: SourceOrdersRow[]
  sessions: SourceSessionsRow[]
  summary: {
    totalOrders: number
    totalRevenue: number
    attributedOrders: number
    googleAdsOrders: number
    googleAdsRevenue: number
    googleAdsSessions: number
  }
}

const rowsOrEmpty = <T>(p: Promise<T[]> | undefined): Promise<T[]> =>
  Promise.resolve(p).then(
    r => r ?? [],
    () => []
  )

export async function getTrafficSources(days: number): Promise<TrafficSources> {
  // Columns may be absent on a store whose schema has not caught up yet; the report then shows empty.
  const [orderRows, sessionRows] = await Promise.all([
    rowsOrEmpty(
      queryMany<{ channel: string; medium: string | null; campaign: string | null; orders: string; revenue: string }>(
        `SELECT ${CHANNEL_SQL} AS channel,
              NULLIF(LOWER(utm_medium), '') AS medium,
              NULLIF(utm_campaign, '') AS campaign,
              COUNT(*) AS orders,
              COALESCE(SUM(total_amount), 0) AS revenue
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND ${COUNTED_ORDER_SQL}
       GROUP BY 1, 2, 3
       ORDER BY revenue DESC, orders DESC`,
        [days]
      )
    ),
    rowsOrEmpty(
      queryMany<{ channel: string; medium: string | null; campaign: string | null; sessions: string }>(
        `SELECT ${CHANNEL_SQL} AS channel,
              NULLIF(LOWER(utm_medium), '') AS medium,
              NULLIF(utm_campaign, '') AS campaign,
              COUNT(DISTINCT session_id) AS sessions
       FROM page_events
       WHERE created_at >= NOW() - INTERVAL '1 day' * $1
       GROUP BY 1, 2, 3
       ORDER BY sessions DESC
       LIMIT 50`,
        [days]
      )
    ),
  ])

  const orders = orderRows.map(r => ({
    channel: r.channel,
    medium: r.medium,
    campaign: r.campaign,
    orders: parseInt(r.orders) || 0,
    revenue: parseFloat(r.revenue) || 0,
  }))
  const sessions = sessionRows.map(r => ({
    channel: r.channel,
    medium: r.medium,
    campaign: r.campaign,
    sessions: parseInt(r.sessions) || 0,
  }))

  const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)
  const ads = orders.filter(r => r.channel === GOOGLE_ADS_CHANNEL)
  return {
    orders: orders.slice(0, 50),
    sessions,
    summary: {
      totalOrders: sum(orders, r => r.orders),
      totalRevenue: Math.round(sum(orders, r => r.revenue) * 100) / 100,
      attributedOrders: sum(
        orders.filter(r => r.channel !== UNATTRIBUTED_CHANNEL),
        r => r.orders
      ),
      googleAdsOrders: sum(ads, r => r.orders),
      googleAdsRevenue: Math.round(sum(ads, r => r.revenue) * 100) / 100,
      googleAdsSessions: sum(
        sessions.filter(r => r.channel === GOOGLE_ADS_CHANNEL),
        r => r.sessions
      ),
    },
  }
}
